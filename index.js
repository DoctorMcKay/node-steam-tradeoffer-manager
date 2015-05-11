var SteamCommunity = require('steamcommunity');

module.exports = TradeOfferManager;

TradeOfferManager.SteamID = require('steamid');
TradeOfferManager.ETradeOfferState = require('./resources/ETradeOfferState.js');
TradeOfferManager.EOfferFilter = require('./resources/EOfferFilter.js');

/**
 * A TradeOfferManager represents the concept of trade offers in the context of a Steam account. It is a master object which manages all trade offers for the account.
 * It polls trade offer status from Steam every 30 seconds and acts on any offers which might have changed.
 * If a SteamClient is available, it polls immediately on notification from Steam in addition to every 30 seconds.
 * @constructor
 * @param {SteamClient} steam - A node-steam SteamClient object, or `null` if unavailable.
 * @param {string} domain - Your domain name. You can use `localhost` if none. Used to register your API key if you don't yet have one.
 * @param {string} language - A language code to return item data in. `null` if you don't want/need item data.
 */
function TradeOfferManager(steam, domain, language) {
	this._steam = steam;
	this._community = new SteamCommunity();
	this._domain = domain || 'localhost';
	this._language = language;
	
	this._request = this._community._request; // I probably shouldn't be doing this...
	
	this.apiKey = null;
}

TradeOfferManager.prototype.setCookies = function(cookies, callback) {
	this._community.setCookies(cookies);
	this._checkApiKey(callback);
};

TradeOfferManager.prototype.parentalUnlock = function(pin, callback) {
	this._community.parentalUnlock(pin, callback);
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
