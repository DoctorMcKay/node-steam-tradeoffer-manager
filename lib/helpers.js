"use strict";

const SteamID = require('steamid');

const EResult = require('../resources/EResult.js');
const EconItem = require('./classes/EconItem.js');
const TradeOffer = require('./classes/TradeOffer.js');
const EConfirmationMethod = require('../resources/EConfirmationMethod.js');

exports.itemEquals = function(a, b) {
	return a.appid == b.appid && a.contextid == b.contextid && (a.assetid || a.id) == (b.assetid || b.id);
};

exports.makeAnError = function(error, callback, body) {
	if (callback) {
		if (body && body.strError) {
			error = new Error(body.strError);

			var match = body.strError.match(/\((\d+)\)$/);
			if (match) {
				error.eresult = parseInt(match[1], 10);
			}

			if (body.strError.match(/You cannot trade with .* because they have a trade ban./)) {
				error.cause = 'TradeBan';
			}

			if (body.strError.match(/You have logged in from a new device/)) {
				error.cause = 'NewDevice';
			}

			if (body.strError.match(/is not available to trade\. More information will be shown to/)) {
				error.cause = 'TargetCannotTrade';
			}

			if (body.strError.match(/sent too many trade offers/)) {
				error.cause = 'OfferLimitExceeded';
				error.eresult = EResult.LimitExceeded;
			}

			if (body.strError.match(/unable to contact the game's item server/)) {
				error.cause = 'ItemServerUnavailable';
				error.eresult = EResult.ServiceUnavailable;
			}

			callback(error);

			return error;
		} else {
			callback(error);
			return error;
		}
	}

	return null;
};

function offerSuperMalformed(offer) {
	return !offer.accountid_other;
}

function offerMalformed(offer) {
	return offerSuperMalformed(offer) || ((offer.items_to_give || []).length == 0 && (offer.items_to_receive || []).length == 0);
}

function processItems(items) {
	return items.map(item => new EconItem(item));
}

exports.offerSuperMalformed = offerSuperMalformed;
exports.offerMalformed = offerMalformed;
exports.processItems = processItems;

exports.checkNeededDescriptions = function(manager, offers, callback) {
	if (!manager._language) {
		callback(null);
		return;
	}

	var items = [];
	offers.forEach((offer) => {
		(offer.items_to_give || []).concat(offer.items_to_receive || []).forEach((item) => {
			if (!manager._hasDescription(item)) {
				items.push(item);
			}
		});
	});

	if (!items.length) {
		callback(null);
		return;
	}

	manager._requestDescriptions(items, callback);
};

exports.createOfferFromData = function(manager, data) {
	var offer = new TradeOffer(manager, new SteamID('[U:1:' + data.accountid_other + ']'));
	offer.id = data.tradeofferid.toString();
	offer.message = data.message;
	offer.state = data.trade_offer_state;
	offer.itemsToGive = data.items_to_give || [];
	offer.itemsToReceive = data.items_to_receive || [];
	offer.isOurOffer = data.is_our_offer;
	offer.created = new Date(data.time_created * 1000);
	offer.updated = new Date(data.time_updated * 1000);
	offer.expires = new Date(data.expiration_time * 1000);
	offer.tradeID = data.tradeid ? data.tradeid.toString() : null;
	offer.fromRealTimeTrade = data.from_real_time_trade;
	offer.confirmationMethod = data.confirmation_method || EConfirmationMethod.None;
	offer.escrowEnds = data.escrow_end_date ? new Date(data.escrow_end_date * 1000) : null;
	offer.rawJson = JSON.stringify(data, null, "\t");

	if (manager._language) {
		offer.itemsToGive = manager._mapItemsToDescriptions(null, null, offer.itemsToGive);
		offer.itemsToReceive = manager._mapItemsToDescriptions(null, null, offer.itemsToReceive);
	} else {
		offer.itemsToGive = processItems(offer.itemsToGive);
		offer.itemsToReceive = processItems(offer.itemsToReceive);
	}

	return offer;
};
