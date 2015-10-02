var SteamCommunity = require('steamcommunity');

module.exports = TradeOfferManager;

TradeOfferManager.SteamID = require('steamid');
TradeOfferManager.ETradeOfferState = require('../resources/ETradeOfferState.js');
TradeOfferManager.EOfferFilter = require('../resources/EOfferFilter.js');
TradeOfferManager.EResult = require('../resources/EResult.js');

TradeOfferManager.getStateName = function(state) {
	for(var i in TradeOfferManager.ETradeOfferState) {
		if(TradeOfferManager.ETradeOfferState[i] == state) {
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
	
	this._community = new SteamCommunity();
	this._request = this._community.request;
	this._assetCache = {};
	this._pollTimer = null;
	this._lastPoll = 0;

	this.pollInterval = options.pollInterval || 30000;
	this.cancelTime = options.cancelTime;

	this.pollData = {};
	this.apiKey = null;
	this.steamID = null;
	
	if(this._language) {
		var lang = require('languages').getLanguageInfo(this._language);
		if(!lang.name) {
			this._language = null;
			this._languageName = null;
		} else {
			this._languageName = lang.name.toLowerCase();
		}
	}
	
	if(this._steam) {
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
	if(this._languageName) {
		cookies = cookies.concat(['Steam_Language=' + this._languageName]);
	}
	
	this._community.setCookies(cookies);
	this.steamID = this._community.steamID;
	this._checkApiKey(function(err) {
		if(!err) {
			if(!this._pollTimer && this.pollInterval >= 1000) {
				this.doPoll();
			}
		}
		
		callback(err);
	}.bind(this));
};

TradeOfferManager.prototype.shutdown = function() {
	clearTimeout(this._pollTimer);
	this._community = new SteamCommunity();
	this._request = this._community.request;
	this._steam = null;
};

TradeOfferManager.prototype.parentalUnlock = function(pin, callback) {
	this._community.parentalUnlock(pin, function(err) {
		if(err && callback) {
			callback(err);
		}
	});
};

TradeOfferManager.prototype._checkApiKey = function(callback) {
	if(this.apiKey) {
		if(callback) {
			callback();
		}
		
		return;
	}
	
	this._community.getWebApiKey(this._domain, function(err, key) {
		if(err) {
			callback(err);
			return;
		}
		
		this.apiKey = key;
		callback();
	}.bind(this));
};

TradeOfferManager.prototype.loadInventory = function(appid, contextid, tradableOnly, callback) {
	this._community.getUserInventory(this._community.steamID, appid, contextid, tradableOnly, callback);
};

TradeOfferManager.prototype.getOfferToken = function(callback) {
	this._request("https://steamcommunity.com/my/tradeoffers/privacy", function(err, response, body) {
		if(err || response.statusCode != 200) {
			callback(err || new Error("HTTP error " + response.statusCode));
			return;
		}
		
		var match = body.match(/https?:\/\/(www.)?steamcommunity.com\/tradeoffer\/new\/?\?partner=\d+(&|&amp;)token=([a-zA-Z0-9-_]+)/);
		if(match) {
			callback(null, match[3]);
		} else {
			callback(new Error("Malformed response"));
		}
	});
};

function makeAnError(error, callback) {
	if(callback) {
		callback(error);
	}
}

require('./webapi.js');
require('./assets.js');
require('./polling.js');
require('./classes/TradeOffer.js');
