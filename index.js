var SteamCommunity = require('steamcommunity');

module.exports = TradeOfferManager;

TradeOfferManager.SteamID = require('steamid');
TradeOfferManager.ETradeOfferState = require('./resources/ETradeOfferState.js');
TradeOfferManager.EOfferFilter = require('./resources/EOfferFilter.js');

require('util').inherits(TradeOfferManager, require('events').EventEmitter);

function TradeOfferManager(steam, domain, language, pollInterval) {
	this._steam = steam;
	this._community = new SteamCommunity();
	this._domain = domain || 'localhost';
	this._language = language;
	this._languageName = null;
	this._pollInterval = pollInterval || 30000;
	this._pollTimer = null;
	this._lastPoll = 0;
	this.pollData = {};
	
	if(language) {
		var lang = require('languages').getLanguageInfo(language);
		if(!lang.name) {
			this._language = null;
		} else {
			this._languageName = lang.name.toLowerCase();
		}
	}
	
	if(this._steam) {
		this._steam.on('tradeOffers', function(count) {
			this._doPoll();
		}.bind(this));
		
		// We don't have access to the Steam namespace, so we'll need to use a hardcoded value
		// UPDATE THIS if node-steam ever handles the ClientItemAnnouncements msg
		this._steam._handlers[5576] = function(data) {
			this._doPoll();
		}.bind(this);
	}
	
	this._request = this._community._request; // I probably shouldn't be doing this...
	
	this._assetCache = {};
	
	this.apiKey = null;
}

TradeOfferManager.prototype.setCookies = function(cookies, callback) {
	if(this._languageName) {
		cookies = cookies.concat(['Steam_Language=' + this._languageName]);
	}
	
	this._community.setCookies(cookies);
	this._checkApiKey(function(err) {
		if(!err) {
			if(!this._pollTimer && this._pollInterval >= 1000) {
				this._pollTimer = setTimeout(this._doPoll.bind(this), this._pollInterval);
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
			return makeAnError(new Error(err), callback);
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
			return callback(err || new Error("HTTP error " + response.statusCode));
		}
		
		if(!body || !body.success || !body.rgInventory || !body.rgDescriptions || !body.rgCurrency) {
			return callback(new Error("Malformed response"));
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

TradeOfferManager.prototype._doPoll = function() {
	// TODO
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
