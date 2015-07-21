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
	this._pollInterval = options.pollInterval || 30000;
	this._cancelTime = options.cancelTime;
	
	this._community = new SteamCommunity();
	this._request = this._community.request;
	this._assetCache = {};
	this._pollTimer = null;
	this._lastPoll = 0;
	
	this.pollData = {};
	this.apiKey = null;
	
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
		
		// This is emitted by https://www.npmjs.com/package/steam-user when new items are announced
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
	this._checkApiKey(function(err) {
		if(!err) {
			if(!this._pollTimer && this._pollInterval >= 1000) {
				this.doPoll();
			}
		}
		
		callback(err);
	}.bind(this));
};

TradeOfferManager.prototype.parentalUnlock = function(pin, callback) {
	this._community.parentalUnlock(pin, function(err) {
		if(err && callback) {
			callback(new Error(err));
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
			makeAnError(new Error(err), callback);
			return;
		}
		
		this.apiKey = key;
		callback();
	}.bind(this));
};

TradeOfferManager.prototype.loadInventory = function(appid, contextid, tradableOnly, callback, data, start) {
	this._request('https://steamcommunity.com/my/inventory/json/' + appid + '/' + contextid + '/', {
		"qs": {
			"start": start,
			"l": this._languageName,
			"trading": tradableOnly ? 1 : undefined
		},
		"json": true
	}, function(err, response, body) {
		if(err || response.statusCode != 200) {
			callback(err || new Error("HTTP error " + response.statusCode));
			return;
		}
		
		if(!body || !body.success || !body.rgInventory || !body.rgDescriptions || !body.rgCurrency) {
			callback(new Error("Malformed response"));
			return;
		}
		
		this._digestDescriptions(body.rgDescriptions);
		
		data = (data || []).concat(this._mapItemsToDescriptions(appid, contextid, body.rgInventory)).concat(this._mapItemsToDescriptions(appid, contextid, body.rgCurrency));
		if(body.more) {
			this.loadInventory(appid, contextid, tradableOnly, callback, data, body.more_start);
		} else {
			callback(null, data);
		}
	}.bind(this));
};

TradeOfferManager.prototype.getOfferToken = function(callback) {
	this._request("https://steamcommunity.com/my/tradeoffers/privacy", function(err, response, body) {
		if(err || response.statusCode != 200) {
			callback(err || new Error("HTTP error " + response.statusCode));
			return;
		}
		
		var match = body.match(/https?:\/\/(www.)?steamcommunity.com\/tradeoffer\/new\/?\?partner=\d+(&|&amp;)token=([a-zA-Z0-9]+)/);
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
