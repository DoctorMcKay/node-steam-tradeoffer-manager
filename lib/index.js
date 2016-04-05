var SteamCommunity = require('steamcommunity');
var Helpers = require('./helpers.js');

module.exports = TradeOfferManager;

var SteamID = TradeOfferManager.SteamID = require('steamid');
var ETradeOfferState = TradeOfferManager.ETradeOfferState = require('../resources/ETradeOfferState.js');
var EOfferFilter = TradeOfferManager.EOfferFilter = require('../resources/EOfferFilter.js');
var EResult = TradeOfferManager.EResult = require('../resources/EResult.js');
var EConfirmationMethod = TradeOfferManager.EConfirmationMethod = require('../resources/EConfirmationMethod.js');

TradeOfferManager.getStateName = function(state) {
	for (var i in TradeOfferManager.ETradeOfferState) {
		if (TradeOfferManager.ETradeOfferState[i] == state) {
			return i;
		}
	}

	return state;
};

require('util').inherits(TradeOfferManager, require('events').EventEmitter);

function TradeOfferManager(options) {
	options = options || {};

	this._steam = options.steam;
	this._domain = options.domain || 'localhost';
	this._language = options.language;

	this._community = options.community || new SteamCommunity();
	this._pollTimer = null;
	this._lastPoll = 0;
	this._lastPollFullUpdate = 0;

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
		this._steam.on('tradeOffers', function(count) {
			this.doPoll();
		}.bind(this));

		// This is an instance of https://www.npmjs.com/package/steam-user, and newItems is emitted when new items are announced
		this._steam.on('newItems', function(count) {
			this.doPoll();
		}.bind(this));
	}
}

TradeOfferManager.prototype.setCookies = function(cookies, callback) {
	if (this.hasShutDown) {
		delete this.hasShutDown;
	}

	this._community.setCookies(cookies);
	this.steamID = this._community.steamID;
	this._checkApiKey(function(err) {
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
	}.bind(this));
};

TradeOfferManager.prototype.shutdown = function() {
	clearTimeout(this._pollTimer);
	this._community = new SteamCommunity();
	this._steam = null;
	this.apiKey = null;
	this.hasShutDown = true;
};

TradeOfferManager.prototype.parentalUnlock = function(pin, callback) {
	this._community.parentalUnlock(pin, function(err) {
		if (err && callback) {
			callback(err);
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

	this._community.getWebApiKey(this._domain, function(err, key) {
		if (err) {
			callback(err);
			return;
		}

		this.apiKey = key;
		callback();
	}.bind(this));
};

TradeOfferManager.prototype.loadInventory = function(appid, contextid, tradableOnly, callback) {
	this.loadUserInventory(this.steamID, appid, contextid, tradableOnly, callback);
};

TradeOfferManager.prototype.loadUserInventory = function(uid, appid, contextid, tradableOnly, callback) {
	this._community.getUserInventory(uid, appid, contextid, tradableOnly, callback);
};

TradeOfferManager.prototype.getOfferToken = function(callback) {
	this._community.httpRequest("https://steamcommunity.com/my/tradeoffers/privacy", function(err, response, body) {
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

TradeOfferManager.prototype.getEscrowDuration = function(steamID, token, callback) {
	if (typeof token === 'function') {
		callback = token;
		token = undefined;
	}

	if (typeof steamID !== 'object') {
		steamID = new SteamID(steamID);
	}

	this._community.httpRequestGet({
		"uri": "https://steamcommunity.com/tradeoffer/new/",
		"qs": {
			"partner": steamID.accountid,
			"token": token || undefined
		}
	}, this._escrowDurationResponse.bind(callback), "tradeoffermanager");
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

	this.getOffers(includeInactive ? EOfferFilter.All : EOfferFilter.ActiveOnly, function(err, sent, received) {
		if (err) {
			callback(err);
			return;
		}

		callback(null, sent.filter(filterFunc), received.filter(filterFunc));
	});

	function filterFunc(offer) {
		return items.some(function(item) {
			return offer.containsItem(item);
		});
	}
};

TradeOfferManager.prototype._escrowDurationResponse = function(err, response, body) {
	var callback = this; // horrible hack but I don't care

	if (err || response.statusCode != 200) {
		callback(err || new Error("HTTP error " + response.statusCode));
		return;
	}

	var mine = body.match(/var g_daysMyEscrow = (\d+);/);
	var theirs = body.match(/var g_daysTheirEscrow = (\d+);/);
	if (mine && theirs) {
		callback(null, parseInt(theirs[1], 10), parseInt(mine[1], 10));
		return;
	}

	// No escrow stuff found, look for an error message
	var error = body.match(/<div id="error_msg">([^<]+)<\/div>/);
	if (error) {
		callback(new Error(error[1].trim()));
		return;
	}

	callback(new Error("Malformed response"));
};

require('./webapi.js');
require('./assets.js');
require('./polling.js');
require('./classes/TradeOffer.js');
