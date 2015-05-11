var TradeOfferManager = require('../index.js');
var SteamID = require('steamid');

var ETradeOfferState = TradeOfferManager.ETradeOfferState;

TradeOfferManager.prototype.createOffer = function(partner) {
	return new TradeOffer(this, partner);
};

function TradeOffer(manager, partner) {
	if(partner instanceof SteamID) {
		this.partner = partner;
	} else {
		this.partner = new SteamID(partner);
	}
	
	this._manager = manager;
	
	this.id = null;
	this.counteredID = null;
	this.message = null;
	this.state = TradeOfferManager.ETradeOfferState.Invalid;
	this.itemsToGive = [];
	this.itemsToReceive = [];
	this.isOurOffer = null;
	this.created = null;
	this.updated = null;
	this.expires = null;
	this.tradeID = null;
	this.fromRealTimeTrade = null;
}

TradeOffer.prototype.send = function(callback) {
	if(this.id) {
		return makeAnError(new Error("This offer has already been sent"), callback);
	}
	
	// TODO
};

TradeOffer.prototype.cancel = function(callback) {
	if(!this.id) {
		return makeAnError(new Error("This offer has not been sent, so it cannot be cancelled"), callback);
	}
	
	if(this.state != ETradeOfferState.Active) {
		return makeAnError(new Error("Offer #" + this.id + " is not active, so it may not be cancelled or declined"), callback);
	}
	
	this._manager._apiCall('POST', this.isOurOffer ? 'CancelTradeOffer' : 'DeclineTradeOffer', 1, {"tradeofferid": this.id}, function(err, body) {
		if(err) {
			makeAnError(err, callback);
		}
		
		if(callback) {
			callback();
		}
	});
};

TradeOffer.prototype.decline = function(callback) {
	// Alias of cancel
	this.cancel(callback);
};

TradeOffer.prototype.accept = function(callback) {
	if(this.state != ETradeOfferState.Active) {
		return makeAnError(new Error("Offer #" + this.id + " is not active, so it may not be accepted"), callback);
	}
	
	if(this.isOurOffer) {
		return makeAnError(new Error("Cannot accept our own offer #" + this.id), callback);
	}
	
	// TODO
};


function makeAnError(error, callback) {
	if(callback) {
		callback(error);
	} else {
		throw error;
	}
}
