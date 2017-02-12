"use strict";

const SteamCommunity = require('steamcommunity');
const Helpers = require('./helpers.js');

module.exports = TradeOfferManager;

const SteamID = TradeOfferManager.SteamID = require('steamid');
const ETradeOfferState = TradeOfferManager.ETradeOfferState = require('../resources/ETradeOfferState.js');
const EOfferFilter = TradeOfferManager.EOfferFilter = require('../resources/EOfferFilter.js');
const EResult = TradeOfferManager.EResult = require('../resources/EResult.js');
const EConfirmationMethod = TradeOfferManager.EConfirmationMethod = require('../resources/EConfirmationMethod.js');
const ETradeStatus = TradeOfferManager.ETradeStatus = require('../resources/ETradeStatus.js');

require('util').inherits(TradeOfferManager, require('events').EventEmitter);

function TradeOfferManager(options) {
	options = options || {};

	this._steam = options.steam;
	this._domain = options.domain || 'localhost';
	this._language = options.language;

	if (this._domain == 'doctormckay.com' && !process.env.MCKAY_BOX) {
		throw new Error("Please fill in your own domain. I'm pretty sure you don't own doctormckay.com.");
	}

	this._community = options.community || new SteamCommunity();
	this._pollTimer = null;
	this._lastPoll = 0;
	this._lastPollFullUpdate = 0;
	this._pendingOfferSendResponses = 0;

	if (options.globalAssetCache) {
		global._steamTradeOfferManagerAssetCache = global._steamTradeOfferManagerAssetCache || {};
		this._assetCache = global._steamTradeOfferManagerAssetCache;
	} else {
		this._assetCache = {};
	}

	this.pollInterval = options.pollInterval || 30000;
	this.cancelTime = options.cancelTime;
	this.pendingCancelTime = options.pendingCancelTime;
	this.cancelOfferCount = options.cancelOfferCount;
	this.cancelOfferCountMinAge = options.cancelOfferCountMinAge || 0;

	this.pollData = options.pollData || {};
	this.apiKey = null;
	this.steamID = null;

	if (this._language) {
		var lang = require('languages').getLanguageInfo(this._language);
		if (!lang.name) {
			this._language = null;
			this._languageName = null;
		} else {
			this._languageName = lang.name.toLowerCase();
		}
	}

	if (this._steam) {
		this._steam.on('tradeOffers', (count) => {
			this.doPoll();
		});

		// This is an instance of https://www.npmjs.com/package/steam-user, and newItems is emitted when new items are announced
		this._steam.on('newItems', (count) => {
			this.doPoll();
		});
	}
}

TradeOfferManager.prototype.setCookies = function(cookies, familyViewPin, callback) {
	if (this.hasShutDown) {
		delete this.hasShutDown;
	}

	if (typeof familyViewPin === 'function') {
		callback = familyViewPin;
		familyViewPin = null;
	}

	this._community.setCookies(cookies);
	this.steamID = this._community.steamID;

	var checkDone = (err) => {
		if (!err) {
			if (this._languageName) {
				this._community.setCookies(['Steam_Language=' + this._languageName]);
			}

			if (!this._pollTimer && this.pollInterval >= 1000) {
				this.doPoll();
			}
		}

		if (callback) {
			callback(err);
		}
	};

	if (familyViewPin) {
		this.parentalUnlock(familyViewPin, (err) => {
			if (err) {
				if (callback) {
					callback(err);
				}
			} else {
				this._checkApiKey(checkDone);
			}
		});
	} else {
		this._checkApiKey(checkDone);
	}
};

TradeOfferManager.prototype.shutdown = function() {
	clearTimeout(this._pollTimer);
	this._community = new SteamCommunity();
	this._steam = null;
	this.apiKey = null;
	this.hasShutDown = true;
};

TradeOfferManager.prototype.parentalUnlock = function(pin, callback) {
	this._community.parentalUnlock(pin, (err) => {
		if (callback) {
			callback(err || null);
		}
	});
};

TradeOfferManager.prototype._checkApiKey = function(callback) {
	if (this.apiKey) {
		if (callback) {
			callback();
		}

		return;
	}

	this._community.getWebApiKey(this._domain, (err, key) => {
		if (err) {
			callback(err);
			return;
		}

		this.apiKey = key;
		callback();
	});
};

/**
 * Get the contents of your own specific inventory context.
 * @param {int} appid - The Steam application ID of the game for which you want an inventory
 * @param {int} contextid - The ID of the "context" within the game you want to retrieve
 * @param {boolean} tradableOnly - true to get only tradable items and currencies
 * @param callback
 */
TradeOfferManager.prototype.getInventoryContents = function(appid, contextid, tradableOnly, callback) {
	this.getUserInventoryContents(this.steamID, appid, contextid, tradableOnly, callback);
};

/**
 * Get the contents of a user's specific inventory context.
 * @param {SteamID|string} sid - The user's SteamID as a SteamID object or a string which can parse into one
 * @param {int} appid - The Steam application ID of the game for which you want an inventory
 * @param {int} contextid - The ID of the "context" within the game you want to retrieve
 * @param {boolean} tradableOnly - true to get only tradable items and currencies
 * @param callback
 */
TradeOfferManager.prototype.getUserInventoryContents = function(sid, appid, contextid, tradableOnly, callback) {
	this._community.getUserInventoryContents(sid, appid, contextid, tradableOnly, callback);
};

/**
 * Get the contents of your own specific inventory context.
 * @deprecated Use getInventoryContents instead
 * @param {int} appid - The Steam application ID of the game for which you want an inventory
 * @param {int} contextid - The ID of the "context" within the game you want to retrieve
 * @param {boolean} tradableOnly - true to get only tradable items and currencies
 * @param callback
 */
TradeOfferManager.prototype.loadInventory = function(appid, contextid, tradableOnly, callback) {
	this.loadUserInventory(this.steamID, appid, contextid, tradableOnly, callback);
};

/**
 * Get the contents of a user's specific inventory context.
 * @deprecated Use getUserInventoryContents instead
 * @property {SteamID|string} sid - The user's SteamID as a SteamID object or a string which can parse into one
 * @param {int} appid - The Steam application ID of the game for which you want an inventory
 * @param {int} contextid - The ID of the "context" within the game you want to retrieve
 * @param {boolean} tradableOnly - true to get only tradable items and currencies
 * @param callback
 */
TradeOfferManager.prototype.loadUserInventory = function(sid, appid, contextid, tradableOnly, callback) {
	this._community.getUserInventory(sid, appid, contextid, tradableOnly, callback);
};

TradeOfferManager.prototype.getOfferToken = function(callback) {
	var path = "profiles/" + this.steamID.getSteamID64();

	if (this._steam && this._steam.vanityURL) {
		path = "id/" + this._steam.vanityURL;
	}

	this._community.httpRequest(`https://steamcommunity.com/${path}/tradeoffers/privacy`, (err, response, body) => {
		if (err || response.statusCode != 200) {
			callback(err || new Error("HTTP error " + response.statusCode));
			return;
		}

		var match = body.match(/https?:\/\/(www.)?steamcommunity.com\/tradeoffer\/new\/?\?partner=\d+(&|&amp;)token=([a-zA-Z0-9-_]+)/);
		if (match) {
			callback(null, match[3]);
		} else {
			callback(new Error("Malformed response"));
		}
	}, "tradeoffermanager");
};

TradeOfferManager.prototype.getOffersContainingItems = function(items, includeInactive, callback) {
	if (typeof includeInactive === 'function') {
		callback = includeInactive;
		includeInactive = false;
	}

	if (typeof items.length === 'undefined') {
		// not an array
		items = [items];
	}

	this.getOffers(includeInactive ? EOfferFilter.All : EOfferFilter.ActiveOnly, (err, sent, received) => {
		if (err) {
			callback(err);
			return;
		}

		callback(null, sent.filter(filterFunc), received.filter(filterFunc));
	});

	function filterFunc(offer) {
		return items.some(item => offer.containsItem(item));
	}
};

require('./webapi.js');
require('./assets.js');
require('./polling.js');
require('./classes/TradeOffer.js');
