var SteamCommunity = require('steamcommunity');

module.exports = TradeOfferManager;

TradeOfferManager.SteamID = require('steamid');
TradeOfferManager.ETradeOfferState = require('./resources/ETradeOfferState.js');

function TradeOfferManager(steam, domain) {
	this._steam = steam;
	this._community = new SteamCommunity();
	this._domain = domain || 'localhost';
	
	this._request = this._community._request; // I probably shouldn't be doing this...
	
	this.apiKey = null;
}

TradeOfferManager.prototype.setCookies = function(cookies, callback) {
	this._community.setCookies(cookies);
	this._checkApiKey(callback);
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

function makeAnError(error, callback) {
	if(typeof callback === 'boolean' && !callback) {
		return;
	}
	
	if(typeof callback === 'function') {
		callback(error);
	} else {
		throw error;
	}
}

require('./webapi.js');
