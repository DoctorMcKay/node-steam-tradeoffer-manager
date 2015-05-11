var TradeOfferManager = require('../index.js');
var SteamID = require('steamid');

var ETradeOfferState = TradeOfferManager.ETradeOfferState;
var EOfferFilter = TradeOfferManager.EOfferFilter;

TradeOfferManager.prototype.createOffer = function(partner) {
	return new TradeOffer(this, partner);
};

TradeOfferManager.prototype.getOffer = function(id, callback) {
	this._apiCall('GET', 'GetTradeOffer', 1, {"tradeofferid": id}, function(err, body) {
		if(err) {
			return callback(err);
		}
		
		if(!body.response || !body.response.offer) {
			return callback(new Error("Malformed API response"));
		}
		
		callback(null, createOfferFromData(this, body.response.offer));
	}.bind(this));
};

TradeOfferManager.prototype.getOffers = function(filter, historicalCutoff, callback) {
	if(typeof historicalCutoff === 'function') {
		callback = historicalCutoff;
		historicalCutoff = new Date(Date.now() + (31536000000));
	}
	
	var options = {
		"get_sent_offers": 1,
		"get_received_offers": 1,
		"get_descriptions": this._language ? 1 : 0,
		"language": this._language,
		"active_only": filter == EOfferFilter.ActiveOnly ? 1 : 0,
		"historical_only": filter == EOfferFilter.HistoricalOnly ? 1 : 0,
		"time_historical_cutoff": Math.floor(historicalCutoff.getTime())
	};
	
	var manager = this;
	this._apiCall('GET', 'GetTradeOffers', 1, options, function(err, body) {
		if(err) {
			return callback(err);
		}
		
		if(!body.response) {
			return callback(new Error("Malformed API response"));
		}
		
		var sent = (body.response.trade_offers_sent || []).map(function(data) {
			return createOfferFromData(manager, data);
		});
		
		var received = (body.response.trade_offers_received || []).map(function(data) {
			return createOfferFromData(manager, data);
		});
		
		callback(null, sent, received);
	});
};

function createOfferFromData(manager, data) {
	var offer = new TradeOffer(manager, new SteamID('[U:1:' + data.accountid_other + ']'));
	offer.id = data.tradeofferid;
	offer.message = data.message;
	offer.state = data.trade_offer_state;
	offer.itemsToGive = data.items_to_give || [];
	offer.itemsToReceive = data.items_to_receive || [];
	offer.isOurOffer = data.is_our_offer;
	offer.created = new Date(data.time_created * 1000),
	offer.updated = new Date(data.time_updated * 1000),
	offer.expires = new Date(data.expiration_time * 1000),
	offer.tradeID = data.tradeid || null;
	offer.fromRealTimeTrade = data.from_real_time_trade;
	
	return offer;
}

function TradeOffer(manager, partner) {
	if(partner instanceof SteamID) {
		this.partner = partner;
	} else {
		this.partner = new SteamID(partner);
	}
	
	this._manager = manager;
	
	this.id = null;
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
		return makeAnError(new Error("Cannot cancel or decline an unsent offer"), callback);
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
	if(!this.id) {
		return makeAnError(new Error("Cannot accept an unsent offer"), callback);
	}
	
	if(this.state != ETradeOfferState.Active) {
		return makeAnError(new Error("Offer #" + this.id + " is not active, so it may not be accepted"), callback);
	}
	
	if(this.isOurOffer) {
		return makeAnError(new Error("Cannot accept our own offer #" + this.id), callback);
	}
	
	// TODO
};

TradeOffer.prototype.getReceivedItems = function(callback) {
	if(!this.id) {
		return makeAnError(new Error("Cannot request received items on an unsent offer"), callback);
	}
	
	if(this.state != ETradeOfferState.Accepted) {
		return makeAnError(new Error("Offer #" + this.id + " is not accepted, cannot request received items"), callback);
	}
	
	if(!this.tradeID) {
		return makeAnError(new Error("Offer #" + this.id + " is accepted, but does not have a trade ID"), callback);
	}
	
	// TODO
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
