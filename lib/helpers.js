"use strict";

const SteamID = require('steamid');
const VM = require('vm');

const EconItem = require('./classes/EconItem.js');
const EConfirmationMethod = require('../resources/EConfirmationMethod.js');
const EResult = require('../resources/EResult.js');
const TradeOffer = require('./classes/TradeOffer.js');

const Helpers = module.exports;

Helpers.itemEquals = function(a, b) {
	return a.appid == b.appid && a.contextid == b.contextid && (a.assetid || a.id) == (b.assetid || b.id);
};

Helpers.classEquals = function(a, b) {
	return a.appid == b.appid && a.classid == b.classid && (a.instanceid || '0') == (b.instanceid || '0');
};

Helpers.makeAnError = function(error, callback, body) {
	if (callback) {
		if (body && body.strError) {
			error = new Error(body.strError);

			let match = body.strError.match(/\((\d+)\)$/);
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

Helpers.offerSuperMalformed = offerSuperMalformed;
Helpers.offerMalformed = offerMalformed;
Helpers.processItems = processItems;

Helpers.createOfferFromData = function(manager, data) {
	let offer = new TradeOffer(manager, new SteamID('[U:1:' + data.accountid_other + ']'));
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

Helpers.getUserDetailsFromTradeWindow = function(manager, url) {
	return new Promise((resolve, reject) => {
		manager._community.httpRequestGet(url, (err, response, body) => {
			if (err || response.statusCode != 200) {
				Helpers.makeAnError(err || new Error('HTTP error ' + response.statusCode), reject);
				return;
			}

			let script = body.match(/\n\W*<script type="text\/javascript">\W*\r?\n?(\W*var g_rgAppContextData[\s\S]*)<\/script>/);
			if (!script) {
				Helpers.makeAnError(new Error('Malformed response'), reject);
				return;
			}

			script = script[1];
			let pos = script.indexOf('</script>');
			if (pos != -1) {
				script = script.substring(0, pos);
			}

			// Run this script in a VM
			let vmContext = VM.createContext({
				UserYou: {
					SetProfileURL: function() {},
					SetSteamId: function() {}
				},
				UserThem: {
					SetProfileURL: function() {},
					SetSteamId: function() {}
				},
				$J: function() {},
				Event: {
					observe: function() {}
				},
				document: null
			});

			VM.runInContext(script, vmContext);

			let me = {
				personaName: vmContext.g_strYourPersonaName,
				contexts: vmContext.g_rgAppContextData
			};

			let them = {
				personaName: vmContext.g_strTradePartnerPersonaName,
				contexts: vmContext.g_rgPartnerAppContextData || null,
				probation: vmContext.g_bTradePartnerProbation
			};

			// Escrow
			let myEscrow = body.match(/var g_daysMyEscrow = (\d+);/);
			let theirEscrow = body.match(/var g_daysTheirEscrow = (\d+);/);
			if (myEscrow && theirEscrow) {
				me.escrowDays = parseInt(myEscrow[1], 10);
				them.escrowDays = parseInt(theirEscrow[1], 10);
			}

			// Avatars
			let myAvatar = body.match(new RegExp('<img src="([^"]+)"( alt="[^"]*")? data-miniprofile="' + manager.steamID.accountid + '">'));
			let theirAvatar = body.match(new RegExp('<img src="([^"]+)"( alt="[^"]*")? data-miniprofile="' + new SteamID(vmContext.g_ulTradePartnerSteamID).accountid + '">'));
			if (myAvatar) {
				me.avatarIcon = myAvatar[1];
				me.avatarMedium = myAvatar[1].replace('.jpg', '_medium.jpg');
				me.avatarFull = myAvatar[1].replace('.jpg', '_full.jpg');
			}

			if (theirAvatar) {
				them.avatarIcon = theirAvatar[1];
				them.avatarMedium = theirAvatar[1].replace('.jpg', '_medium.jpg');
				them.avatarFull = theirAvatar[1].replace('.jpg', '_full.jpg');
			}

			resolve({me, them});
		});
	});
};
