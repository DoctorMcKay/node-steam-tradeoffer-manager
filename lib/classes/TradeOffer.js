"use strict";

const SteamID = require('steamid');
const Helpers = require('../helpers.js');

const ETradeOfferState = require('../../resources/ETradeOfferState.js');
const EConfirmationMethod = require('../../resources/EConfirmationMethod.js');
const ETradeStatus = require('../../resources/ETradeStatus.js');

function TradeOffer(manager, partner, token) {
	if (typeof partner === 'number') {
		throw new Error('Input SteamID ' + this.partner + ' is a number and not a string; did you make a mistake?');
	} else if (typeof partner === 'string') {
		this.partner = new SteamID(partner);
	} else {
		this.partner = partner;
	}

	if (!this.partner.isValid || !this.partner.isValid() || this.partner.type != SteamID.Type.INDIVIDUAL) {
		throw new Error("Invalid input SteamID " + this.partner);
	}

	Object.defineProperties(this, {
		"_countering": {
			"configurable": true,
			"enumerable": false,
			"writable": true,
			"value": null
		},
		"_tempData": {
			"configurable": true,
			"enumerable": false,
			"writable": true,
			"value": {}
		},
		"_token": {
			"configurable": true,
			"enumerable": false,
			"writable": true,
			"value": token
		},
		"manager": {
			"configurable": false,
			"enumerable": false,
			"writable": false,
			"value": manager
		}
	});

	this.id = null;
	this.message = null;
	this.state = ETradeOfferState.Invalid;
	this.itemsToGive = [];
	this.itemsToReceive = [];
	this.isOurOffer = null;
	this.created = null;
	this.updated = null;
	this.expires = null;
	this.tradeID = null;
	this.fromRealTimeTrade = null;
	this.confirmationMethod = null;
	this.escrowEnds = null;
	this.rawJson = "";
}

/**
 * Figure out if this offer is "glitched". An offer is considered "glitched" if one of the following are true:
 * - It contains no items on either side (an offer cannot be sent like this)
 * - Any item in the offer does not have a name (and a language is set)
 * @returns {boolean}
 */
TradeOffer.prototype.isGlitched = function() {
	if (!this.id) {
		// not sent yet
		return false;
	}

	if (this.itemsToGive.length + this.itemsToReceive.length == 0) {
		return true;
	}

	// Is any item missing its name?
	//noinspection RedundantIfStatementJS
	if (this.manager._language && this.itemsToGive.concat(this.itemsToReceive).some(item => !item.name)) {
		return true;
	}

	return false;
};

/**
 * Figure out if the offer contains an item.
 * @param {{appid, contextid, [assetid], [id]}} item
 * @returns {boolean}
 */
TradeOffer.prototype.containsItem = function(item) {
	return this.itemsToGive.concat(this.itemsToReceive).some(offerItem => Helpers.itemEquals(offerItem, item));
};

/**
 * Get or set a data element on the trade offer.
 * @param {string} key
 * @param {*} [value] - Omit to return the data element at that key
 * @returns {*}
 */
TradeOffer.prototype.data = function(key, value) {
	let pollData = this.manager.pollData;

	if (arguments.length < 1) {
		// No arguments passed, so we return the whole offerData of this offer
		if (!this.id){
			// Offer isn't sent yet, return object cache
			return this._tempData;
		}

		// return offerData from pollData if it exists, else return an empty object
		return (pollData.offerData && pollData.offerData[this.id]) || {};
	} else if (arguments.length < 2) {
		// We're only retrieving the value.
		if (!this.id) {
			// Offer isn't sent yet, return from object cache
			return this._tempData[key];
		}

		return pollData.offerData && pollData.offerData[this.id] && pollData.offerData[this.id][key];
	} else {
		// If this is a special data key, perform necessary checks
		switch (key) {
			case 'cancelTime':
				if (!this.isOurOffer) {
					throw new Error(`Cannot set cancelTime for offer #${this.id} as we did not send it.`);
				}

				if (this.id && this.state != ETradeOfferState.Active && this.state != ETradeOfferState.CreatedNeedsConfirmation) {
					throw new Error(`Cannot set cancelTime for offer #${this.id} as it is not active (${ETradeOfferState[this.state]}).`);
				}

				break;
		}

		if (!this.id) {
			// Offer isn't sent yet. Set in local object cache.
			this._tempData[key] = value;
			return;
		}

		// We're setting the value. Check if the value already exists and is set to this value.
		if (this.data(key) === value) {
			return; // Already set, nothing to do
		}

		// Make sure pollData has offerData set.
		pollData.offerData = pollData.offerData || {};
		pollData.offerData[this.id] = pollData.offerData[this.id] || {};
		pollData.offerData[this.id][key] = value;

		// Emit the pollData event
		this.manager.emit('pollData', pollData);
	}
};

/**
 * Get the tradable contents of your trade partner's inventory for a specific context.
 * @deprecated Use getPartnerInventoryContents instead
 * @param {int} appid
 * @param {int} contextid
 * @param {function} callback
 */
TradeOffer.prototype.loadPartnerInventory = function(appid, contextid, callback) {
	this.manager.loadUserInventory(this.partner, appid, contextid, true, callback);
};

/**
 * Get the tradable contents of your trade partner's inventory for a specific context.
 * @param {int} appid
 * @param {int} contextid
 * @param {function} callback
 */
TradeOffer.prototype.getPartnerInventoryContents = function(appid, contextid, callback) {
	this.manager.getUserInventoryContents(this.partner, appid, contextid, true, callback);
};

/**
 * Add one of your items to this trade offer.
 * @param {{appid, contextid, [assetid], [id]}} item
 * @returns {boolean} - Was the item added?
 */
TradeOffer.prototype.addMyItem = function(item) {
	return addItem(item, this, this.itemsToGive);
};

/**
 * Add one or more of your items to this trade offer.
 * @param {{appid, contextid, [assetid], [id]}[]} items
 * @returns {number} - Number of items added
 */
TradeOffer.prototype.addMyItems = function(items) {
	let added = 0;
	items.forEach((item) => {
		if (this.addMyItem(item)) {
			added++;
		}
	});

	return added;
};

/**
 * Remove one of your items from this trade offer.
 * @param {{appid, contextid, [assetid], [id]}} item
 * @returns {boolean} - Was the item removed?
 */
TradeOffer.prototype.removeMyItem = function(item) {
	if (this.id) {
		throw new Error("Cannot remove items from an already-sent offer");
	}

	for (let i = 0; i < this.itemsToGive.length; i++) {
		if (Helpers.itemEquals(this.itemsToGive[i], item)) {
			this.itemsToGive.splice(i, 1);
			return true;
		}
	}

	return false;
};

/**
 * Remove one or more of your items from this trade offer.
 * @param {{appid, contextid, [assetid], [id]}[]} items
 * @returns {number} - Number of items removed
 */
TradeOffer.prototype.removeMyItems = function(items) {
	let removed = 0;
	items.forEach((item) => {
		if (this.removeMyItem(item)) {
			removed++;
		}
	});

	return removed;
};

/**
 * Add one of their items to this trade offer.
 * @param {{appid, contextid, [assetid], [id]}} item
 * @returns {boolean} - Was the item added?
 */
TradeOffer.prototype.addTheirItem = function(item) {
	return addItem(item, this, this.itemsToReceive);
};

/**
 * Add one or more of their items to this trade offer.
 * @param {{appid, contextid, [assetid], [id]}[]} items
 * @returns {number} - Number of items added
 */
TradeOffer.prototype.addTheirItems = function(items) {
	let added = 0;
	items.forEach((item) => {
		if (this.addTheirItem(item)) {
			added++;
		}
	});

	return added;
};

/**
 * Remove one of their items from this trade offer.
 * @param {{appid, contextid, [assetid], [id]}} item
 * @returns {boolean} - Was the item removed?
 */
TradeOffer.prototype.removeTheirItem = function(item) {
	if (this.id) {
		throw new Error("Cannot remove items from an already-sent offer");
	}

	for (let i = 0; i < this.itemsToReceive.length; i++) {
		if (Helpers.itemEquals(this.itemsToReceive[i], item)) {
			this.itemsToReceive.splice(i, 1);
			return true;
		}
	}

	return false;
};

/**
 * Remove one or more of their items from this trade offer.
 * @param {{appid, contextid, [assetid], [id]}[]} items
 * @returns {number} - Number of items removed
 */
TradeOffer.prototype.removeTheirItems = function(items) {
	let removed = 0;
	items.forEach((item) => {
		if (this.removeTheirItem(item)) {
			removed++;
		}
	});

	return removed;
};

/**
 * @param {{appid, contextid, [assetid], [id]}} details
 * @param {TradeOffer} offer
 * @param {Array} list - List of items already in trade
 * @returns {boolean}
 */
function addItem(details, offer, list) {
	if (offer.id) {
		throw new Error("Cannot add items to an already-sent offer");
	}

	if (typeof details.appid === 'undefined' || typeof details.contextid === 'undefined' || (typeof details.assetid === 'undefined' && typeof details.id === 'undefined')) {
		throw new Error("Missing appid, contextid, or assetid parameter");
	}

	let item = {
		"id": (details.id || details.assetid).toString(), // always needs to be a string
		"assetid": (details.assetid || details.id).toString(), // always needs to be a string
		"appid": parseInt(details.appid, 10), // always needs to be an int
		"contextid": details.contextid.toString(), // always needs to be a string
		"amount": parseInt(details.amount || 1, 10) // always needs to be an int
	};

	if (list.some(tradeItem => Helpers.itemEquals(tradeItem, item))) {
		// Already in trade
		return false;
	}

	list.push(item);
	return true;
}

/**
 * Send this trade offer.
 * @param {function} [callback]
 */
TradeOffer.prototype.send = function(callback) {
	if (this.id) {
		Helpers.makeAnError(new Error("This offer has already been sent"), callback);
		return;
	}

	if (this.itemsToGive.length + this.itemsToReceive.length == 0) {
		Helpers.makeAnError(new Error("Cannot send an empty trade offer"), callback);
		return;
	}

	function itemMapper(item){
		return {
			"appid": item.appid,
			"contextid": item.contextid,
			"amount": item.amount || 1,
			"assetid": item.assetid
		};
	}

	let offerdata = {
		"newversion": true,
		"version": this.itemsToGive.length + this.itemsToReceive.length + 1,
		"me": {
			"assets": this.itemsToGive.map(itemMapper),
			"currency": [], // TODO
			"ready": false
		},
		"them": {
			"assets": this.itemsToReceive.map(itemMapper),
			"currency": [],
			"ready": false
		}
	};

	let params = {};
	if (this._token) {
		params.trade_offer_access_token = this._token;
	}

	this.manager._pendingOfferSendResponses++;

	this.manager._community.httpRequestPost('https://steamcommunity.com/tradeoffer/new/send', {
		"headers": {
			"referer": `https://steamcommunity.com/tradeoffer/${(this.id || 'new')}/?partner=${this.partner.accountid}` + (this._token ? "&token=" + this._token : '')
		},
		"json": true,
		"form": {
			"sessionid": this.manager._community.getSessionID(),
			"serverid": 1,
			"partner": this.partner.toString(),
			"tradeoffermessage": this.message || "",
			"json_tradeoffer": JSON.stringify(offerdata),
			"captcha": '',
			"trade_offer_create_params": JSON.stringify(params),
			"tradeofferid_countered": this._countering
		},
		"checkJsonError": false,
		"checkHttpError": false // we'll check it ourself. Some trade offer errors return HTTP 500
	}, (err, response, body) => {
		this.manager._pendingOfferSendResponses--;

		if (err) {
			Helpers.makeAnError(err, callback);
			return;
		}

		if (response.statusCode != 200) {
			if (response.statusCode == 401) {
				this.manager._community._notifySessionExpired(new Error("HTTP error 401"));
				Helpers.makeAnError(new Error("Not Logged In"), callback);
				return;
			}

			Helpers.makeAnError(new Error("HTTP error " + response.statusCode), callback, body);
			return;
		}

		if (!body) {
			Helpers.makeAnError(new Error("Malformed JSON response"), callback);
			return;
		}

		if (body && body.strError) {
			Helpers.makeAnError(null, callback, body);
			return;
		}

		if (body && body.tradeofferid) {
			this.id = body.tradeofferid;
			this.state = ETradeOfferState.Active;
			this.created = new Date();
			this.updated = new Date();
			this.expires = new Date(Date.now() + 1209600000);

			// Set any temporary local data into persistent poll data
			for (let i in this._tempData) {
				if (this._tempData.hasOwnProperty(i)) {
					this.manager.pollData.offerData = this.manager.pollData.offerData || {};
					this.manager.pollData.offerData[this.id] = this.manager.pollData.offerData[this.id] || {};
					this.manager.pollData.offerData[this.id][i] = this._tempData[i];
				}
			}

			delete this._tempData;
		}

		this.confirmationMethod = EConfirmationMethod.None;

		if (body && body.needs_email_confirmation) {
			this.state = ETradeOfferState.CreatedNeedsConfirmation;
			this.confirmationMethod = EConfirmationMethod.Email;
		}

		if (body && body.needs_mobile_confirmation) {
			this.state = ETradeOfferState.CreatedNeedsConfirmation;
			this.confirmationMethod = EConfirmationMethod.MobileApp;
		}

		this.manager.pollData.sent = this.manager.pollData.sent || {};
		this.manager.pollData.sent[this.id] = this.state;
		this.manager.emit('pollData', this.manager.pollData);

		if (!callback) {
			return;
		}

		if (body && this.state == ETradeOfferState.CreatedNeedsConfirmation) {
			callback(null, 'pending');
		} else if (body && body.tradeofferid) {
			callback(null, 'sent');
		} else {
			callback(new Error("Unknown response"));
		}
	}, "tradeoffermanager");
};

/**
 * Cancel or decline this trade offer.
 * @param {function} [callback]
 */
TradeOffer.prototype.cancel = TradeOffer.prototype.decline = function(callback) {
	if (!this.id) {
		Helpers.makeAnError(new Error("Cannot cancel or decline an unsent offer"), callback);
		return;
	}

	if (this.state != ETradeOfferState.Active && this.state != ETradeOfferState.CreatedNeedsConfirmation) {
		Helpers.makeAnError(new Error(`Offer #${this.id} is not active, so it may not be cancelled or declined`), callback);
		return;
	}

	this.manager._apiCall('POST', this.isOurOffer ? 'CancelTradeOffer' : 'DeclineTradeOffer', 1, {tradeofferid: this.id}).then(() => {
		this.state = this.isOurOffer ? ETradeOfferState.Canceled : ETradeOfferState.Declined;
		this.updated = new Date();

		if (callback) {
			callback(null);
		}

		this.manager.doPoll();
	}).catch((err) => {
		Helpers.makeAnError(err, callback);
	});
};

/**
 * Accept this trade offer.
 * @param {boolean} [skipStateUpdate=false] - If true, don't bother updating the offer's state from the API. This means that you won't get data about whether it went into escrow.
 * @param {function} [callback]
 */
TradeOffer.prototype.accept = function(skipStateUpdate, callback) {
	if (typeof skipStateUpdate === 'undefined') {
		skipStateUpdate = false;
	}

	if (typeof skipStateUpdate === 'function') {
		callback = skipStateUpdate;
		skipStateUpdate = false;
	}

	if (!this.id) {
		Helpers.makeAnError(new Error("Cannot accept an unsent offer"), callback);
		return;
	}

	if (this.state != ETradeOfferState.Active) {
		Helpers.makeAnError(new Error(`Offer #${this.id} is not active, so it may not be accepted`), callback);
		return;
	}

	if (this.isOurOffer) {
		Helpers.makeAnError(new Error(`Cannot accept our own offer #${this.id}`), callback);
		return;
	}

	this.manager._community.httpRequestPost(`https://steamcommunity.com/tradeoffer/${this.id}/accept`, {
		"headers": {
			"Referer": `https://steamcommunity.com/tradeoffer/${this.id}/`
		},
		"json": true,
		"form": {
			"sessionid": this.manager._community.getSessionID(),
			"serverid": 1,
			"tradeofferid": this.id,
			"partner": this.partner.toString(),
			"captcha": ""
		},
		"checkJsonError": false,
		"checkHttpError": false // we'll check it ourself. Some trade offer errors return HTTP 500
	}, (err, response, body) => {
		if (err || response.statusCode != 200) {
			if (response && response.statusCode == 403) {
				this.manager._community._notifySessionExpired(new Error("HTTP error 403"));
				Helpers.makeAnError(new Error("Not Logged In"), callback, body);
			} else {
				Helpers.makeAnError(err || new Error("HTTP error " + response.statusCode), callback, body);
			}

			return;
		}

		if (!body) {
			Helpers.makeAnError(new Error("Malformed JSON response"), callback);
			return;
		}

		if (body && body.strError) {
			Helpers.makeAnError(null, callback, body);
			return;
		}

		this.manager.doPoll();

		if (!callback) {
			return;
		}

		if (skipStateUpdate) {
			if (body.tradeid) {
				this.tradeID = body.tradeid;
			}

			if (body.needs_mobile_confirmation || body.needs_email_confirmation) {
				callback(null, 'pending');
			} else {
				callback(null, 'accepted');
			}
			return;
		}


		this.update((err) => {
			if (err) {
				callback(new Error("Cannot load new trade data: " + err.message));
				return;
			}

			if (this.confirmationMethod !== null && this.confirmationMethod != EConfirmationMethod.None) {
				callback(null, 'pending');
			} else if (this.state == ETradeOfferState.InEscrow) {
				callback(null, 'escrow');
			} else if (this.state == ETradeOfferState.Accepted) {
				callback(null, 'accepted');
			} else {
				callback(new Error("Unknown state " + this.state));
			}
		});
	}, "tradeoffermanager");
};

/**
 * Update this offer from the API
 * @param {function} callback
 */
TradeOffer.prototype.update = function(callback) {
	this.manager.getOffer(this.id, (err, offer) => {
		if (err) {
			callback(err);
			return;
		}

		// Clone only the properties that might be out of date from the new TradeOffer onto this one, unless this one is
		// glitched. Sometimes Steam is bad and some properties are missing/malformed.
		let properties = [
			'id',
			'state',
			'expires',
			'created',
			'updated',
			'escrowEnds',
			'confirmationMethod',
			'tradeID'
		];

		for (let i in offer) {
			if (offer.hasOwnProperty(i) && typeof offer[i] !== 'function' && (properties.indexOf(i) != -1 || this.isGlitched())) {
				this[i] = offer[i];
			}
		}

		callback(null);
	});
};

/**
 * Get details about this item exchange. Only works if the trade was actually completed (i.e. it has a tradeID).
 * @param {boolean} [getDetailsIfFailed=false] - Unless this is true, a trade that is failed (e.g. rolled back) will return an error instead of the data
 * @param {function} callback
 */
TradeOffer.prototype.getExchangeDetails = function(getDetailsIfFailed, callback) {
	if (typeof getDetailsIfFailed === 'function') {
		callback = getDetailsIfFailed;
		getDetailsIfFailed = false;
	}

	if (!this.id) {
		Helpers.makeAnError(new Error('Cannot get trade details for an unsent trade offer'), callback);
		return;
	}

	if (!this.tradeID) {
		Helpers.makeAnError(new Error('No trade ID; unable to get trade details'), callback);
		return;
	}

	this.manager._apiCall('GET', 'GetTradeStatus', 1, {tradeid: this.tradeID}).then((result) => {
		if (!result.response || !result.response.trades) {
			Helpers.makeAnError(new Error("Malformed response"), callback);
			return;
		}

		let trade = result.response.trades[0];
		if (!trade || trade.tradeid != this.tradeID) {
			Helpers.makeAnError(new Error("Trade not found in GetTradeStatus response; try again later"), callback);
			return;
		}

		if (!getDetailsIfFailed && [ETradeStatus.Complete, ETradeStatus.InEscrow, ETradeStatus.EscrowRollback].indexOf(trade.status) == -1) {
			Helpers.makeAnError(new Error("Trade status is " + (ETradeStatus[trade.status] || trade.status)), callback);
			return;
		}

		if (!this.manager._language) {
			// No need for descriptions
			callback(null, trade.status, new Date(trade.time_init * 1000), trade.assets_received || [], trade.assets_given || []);
		} else {
			this.manager._requestDescriptions((trade.assets_received || []).concat(trade.assets_given || []), (err) => {
				if (err) {
					callback(err);
					return;
				}

				let received = this.manager._mapItemsToDescriptions(null, null, trade.assets_received || []);
				let given = this.manager._mapItemsToDescriptions(null, null, trade.assets_given || []);
				callback(null, trade.status, new Date(trade.time_init * 1000), received, given);
			});
		}
	}).catch((err) => {
		Helpers.makeAnError(err, callback);
	});
};

/**
 * Get details about the users in this trade. Can only be used if:
 * - The trade is created by you and *unsent*
 * - The trade is created by them, sent, and *active*
 * @param {function} callback
 */
TradeOffer.prototype.getUserDetails = function(callback) {
	if (this.id && this.isOurOffer) {
		Helpers.makeAnError(new Error("Cannot get user details for an offer that we sent."), callback);
		return;
	}

	if (this.id && this.state != ETradeOfferState.Active) {
		Helpers.makeAnError(new Error("Cannot get user details for an offer that is sent and not Active."), callback);
		return;
	}

	let url;
	if (this.id) {
		url = `https://steamcommunity.com/tradeoffer/${this.id}/`;
	} else {
		url = `https://steamcommunity.com/tradeoffer/new/?partner=${this.partner.accountid}`;
		if (this._token) {
			url += "&token=" + this._token;
		}
	}

	Helpers.getUserDetailsFromTradeWindow(this.manager, url, callback);
};

/**
 * Create a counter offer from this trade offer. Once the counter is sent, this trade will be marked as Countered.
 * @returns {TradeOffer}
 */
TradeOffer.prototype.counter = function() {
	if (this.state != ETradeOfferState.Active) {
		throw new Error("Cannot counter a non-active offer.");
	}

	let offer = this.duplicate();
	offer._countering = this.id;
	return offer;
};

/**
 * Create an unsent duplicate of this trade offer.
 * @returns {TradeOffer}
 */
TradeOffer.prototype.duplicate = function() {
	let offer = new TradeOffer(this.manager, this.partner, this._token);
	offer.itemsToGive = this.itemsToGive.slice();
	offer.itemsToReceive = this.itemsToReceive.slice();
	offer.isOurOffer = true;
	offer.fromRealTimeTrade = false;
	return offer;
};

/**
 * Set this trade offer's message.
 * @param {string} message
 */
TradeOffer.prototype.setMessage = function(message) {
	if (this.id) {
		throw new Error("Cannot set message in an already-sent offer");
	}

	this.message = message.toString().substring(0, 128);
};

/**
 * Set the access token that will be used to send this trade offer.
 * @param {string} token
 */
TradeOffer.prototype.setToken = function(token) {
	if (this.id) {
		throw new Error("Cannot set token in an already-sent offer");
	}

	this._token = token;
};

module.exports = TradeOffer;
