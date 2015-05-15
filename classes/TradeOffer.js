var TradeOfferManager = require('../index.js');
var SteamID = require('steamid');
var Async = require('async');

var ETradeOfferState = TradeOfferManager.ETradeOfferState;
var EOfferFilter = TradeOfferManager.EOfferFilter;

TradeOfferManager.prototype.createOffer = function(partner) {
	var offer = new TradeOffer(this, partner);
	offer.isOurOffer = true;
	offer.fromRealTimeTrade = false;
	return offer;
};

TradeOfferManager.prototype.getOffer = function(id, callback) {
	var manager = this;
	this._apiCall('GET', 'GetTradeOffer', 1, {"tradeofferid": id}, function(err, body) {
		if(err) {
			return callback(err);
		}
		
		if(!body.response) {
			return callback(new Error("Malformed API response"));
		}
		
		if(!body.response.offer) {
			return callback(new Error("No matching offer found"));
		}
		
		manager._digestDescriptions(body.response.descriptions);
		checkNeededDescriptions(manager, [body.response.offer], function(err) {
			if(err) {
				return callback(err);
			}
			
			callback(null, createOfferFromData(manager, body.response.offer));
		});
	});
};

TradeOfferManager.prototype.getOffers = function(filter, historicalCutoff, callback) {
	if(typeof historicalCutoff === 'function') {
		callback = historicalCutoff;
		historicalCutoff = new Date(Date.now() + 31536000000);
	} else if(!historicalCutoff) {
		historicalCutoff = new Date(Date.now() + 31536000000);
	}
	
	var options = {
		"get_sent_offers": 1,
		"get_received_offers": 1,
		"get_descriptions": this._language ? 1 : 0,
		"language": this._language,
		"active_only": filter == EOfferFilter.ActiveOnly ? 1 : 0,
		"historical_only": filter == EOfferFilter.HistoricalOnly ? 1 : 0,
		"time_historical_cutoff": Math.floor(historicalCutoff.getTime() / 1000)
	};
	
	var manager = this;
	this._apiCall('GET', 'GetTradeOffers', 1, options, function(err, body) {
		if(err) {
			return callback(err);
		}
		
		if(!body.response) {
			return callback(new Error("Malformed API response"));
		}
		
		manager._digestDescriptions(body.response.descriptions);
		checkNeededDescriptions(manager, (body.response.trade_offers_sent || []).concat(body.response.trade_offers_received || []), function(err) {
			if(err) {
				return callback(err);
			}
			
			var sent = (body.response.trade_offers_sent || []).map(function(data) {
				return createOfferFromData(manager, data);
			});
			
			var received = (body.response.trade_offers_received || []).map(function(data) {
				return createOfferFromData(manager, data);
			});
			
			callback(null, sent, received);
		});
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
	
	if(manager._language) {
		offer.itemsToGive = manager._mapItemsToDescriptions(null, null, offer.itemsToGive);
		offer.itemsToReceive = manager._mapItemsToDescriptions(null, null, offer.itemsToReceive);
	}
	
	return offer;
}

function checkNeededDescriptions(manager, offers, callback) {
	if(!manager._language) {
		return callback();
	}
	
	var items = [];
	offers.forEach(function(offer) {
		(offer.items_to_give || []).concat(offer.items_to_receive || []).forEach(function(item) {
			if(!manager._hasDescription(item)) {
				items.push(item);
			}
		});
	});
	
	if(!items.length) {
		return callback();
	}
	
	manager._requestDescriptions(items, callback);
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
	this.state = ETradeOfferState.Invalid;
	this.itemsToGive = [];
	this.itemsToReceive = [];
	this.isOurOffer = null;
	this.created = null;
	this.updated = null;
	this.expires = null;
	this.tradeID = null;
	this.fromRealTimeTrade = null;
}

TradeOffer.prototype.loadPartnerInventory = function(appid, contextid, callback, data, start) {
	this._manager._request('https://steamcommunity.com/tradeoffer/' + (this.id ? this.id : 'new') + '/partnerinventory/', {
		"qs": {
			"sessionid": this._manager._community.getSessionID(),
			"partner": this.partner.toString(),
			"appid": appid,
			"contextid": contextid,
			"start": start,
			"l": this._languageName
		},
		"headers": {
			"referer": "https://steamcommunity.com/tradeoffer/" + (this.id ? this.id : 'new') + "/?partner=" + this.partner.accountid
		},
		"json": true
	}, function(err, response, body) {
		if(err || response.statusCode != 200) {
			return callback(err || new Error("HTTP error " + response.statusCode));
		}
		
		if(!body || !body.rgInventory || !body.rgDescriptions || !body.rgCurrency) {
			return callback(new Error("Malformed response"));
		}
		
		this._digestDescriptions(body.rgDescriptions);
		
		data = (data || []).concat(this._mapItemsToDescriptions(appid, contextid, body.rgInventory)).concat(this._mapItemsToDescriptions(appid, contextid, body.rgCurrency));
		if(body.more) {
			this.loadPartnerInventory(appid, contextid, callback, data, body.more_start);
		} else {
			callback(null, data);
		}
	}.bind(this));
};

TradeOffer.prototype.addMyItem = function(item) {
	addItem(item, this, this.itemsToGive);
};

TradeOffer.prototype.addMyItems = function(items) {
	items.forEach(this.addMyItem.bind(this));
};

TradeOffer.prototype.addTheirItem = function(item) {
	addItem(item, this, this.itemsToReceive);
};

TradeOffer.prototype.addTheirItems = function(items) {
	items.forEach(this.addTheirItem.bind(this));
};

function addItem(details, offer, list) {
	if(offer.id) {
		throw new Error("Cannot add items to an already-sent offer");
	}
	
	var item = {
		"assetid": details.assetid || details.id,
		"appid": details.appid,
		"contextid": details.contextid,
		"amount": details.amount || 1
	};
	
	if(!item.appid || !item.contextid || !item.assetid) {
		throw new Error("Missing appid, contextid, or assetid parameter");
	}
	
	if(list.some(function(tradeItem) { return tradeItem.assetid == item.assetid; })) {
		// Already in trade
		return;
	}
	
	list.push(item);
}

TradeOffer.prototype.send = function(message, token, callback) {
	if(this.id) {
		return makeAnError(new Error("This offer has already been sent"), callback);
	}
	
	message = message || '';
	
	if(typeof token !== 'string') {
		callback = token;
		token = null;
	}
	
	var offerdata = {
		"newversion": true,
		"version": 4,
		"me": {
			"assets": this.itemsToGive.map(function(item) {
				return {
					"appid": item.appid,
					"contextid": item.contextid,
					"amount": item.amount || 1,
					"assetid": item.assetid
				};
			}),
			"currency": [], // TODO
			"ready": false
		},
		"them": {
			"assets": this.itemsToReceive.map(function(item) {
				return {
					"appid": item.appid,
					"contextid": item.contextid,
					"amount": item.amount || 1,
					"assetid": item.assetid
				};
			}),
			"currency": [],
			"ready": false
		}
	};
	
	var params = {};
	if(token) {
		params.trade_offer_access_token = token;
	}
	
	this._request.post('https://steamcommunity.com/tradeoffer/new/send', {
		"headers": {
			"referer": "https://steamcommunity.com/tradeoffer/new/?partner=" + this.partner.accountid + (token ? "&token=" + token : '')
		},
		"json": true,
		"form": {
			"sessionid": this._community.getSessionID(),
			"serverid": 1,
			"partner": this.partner.toString(),
			"tradeoffermessage": message,
			"json_tradeoffer": JSON.stringify(offerdata),
			"captcha": '',
			"trade_offer_create_params": JSON.stringify(params)
		}
	}, function(err, response, body) {
		if(err || response.statusCode != 200) {
			return makeAnError(err || new Error("HTTP error " + response.statusCode), callback);
		}
		
		if(body && body.strError) {
			return makeAnError(new Error(body.strError));
		}
		
		if(body && body.tradeofferid) {
			this.id = body.tradeofferid;
			this.message = message;
			this.state = ETradeOfferState.Active;
			this.created = new Date();
			this.updated = new Date();
			this.expires = new Date(Date.now() + 1209600000);
		}
		
		if(body && body.needs_email_confirmation) {
			this.state = ETradeOfferState.EmailPending;
		}
		
		if(!callback) {
			return;
		}
		
		if(body && body.needs_email_confirmation) {
			callback(null, 'pending');
		} else if(body && body.tradeofferid) {
			callback(null, 'sent');
		} else {
			callback(new Error("Unknown response"));
		}
	}.bind(this));
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
		
		this.updated = new Date();
		
		if(callback) {
			callback();
		}
	}.bind(this));
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
	
	this._request.post('https://steamcommunity.com/tradeoffer/' + this.id + '/accept', {
		"headers": {
			"referer": 'https://steamcommunity.com/tradeoffer/' + this.id + '/'
		},
		"json": true,
		"form": {
			"sessionid": this._community.getSessionID(),
			"serverid": 1,
			"tradeofferid": this.id,
			"partner": this.partner.toString(),
			"captcha": ""
		}
	}, function(err, response, body) {
		if(err || response.statusCode != 200) {
			return makeAnError(err || new Error("HTTP error " + response.statusCode), callback);
		}
		
		if(body && body.strError) {
			return makeAnError(new Error(body.strError), callback);
		}
		
		if(body && body.tradeid) {
			this.updated = new Date();
		}
		
		if(!callback) {
			return;
		}
		
		if(body && body.needs_email_confirmation) {
			callback(null, 'pending');
		} else if(body && body.tradeid) {
			this.state = ETradeOfferState.Accepted;
			this.tradeid = body.tradeid;
			callback(null, 'accepted');
		} else {
			callback(new Error("Unknown response"));
		}
	}.bind(this));
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
	
	// Borrowed from node-steam-trade (https://github.com/seishun/node-steam-trade/blob/master/index.js#L86-L119)
	this._request.get('https://steamcommunity.com/trade/' + this.tradeID + '/receipt/', function(err, response, body) {
		if(err || response.statusCode != 200) {
			return makeAnError(err || new Error(response.statusCode), callback);
		}
		
		var script = body.match(/(var oItem;[\s\S]*)<\/script>/);
		if (!script) {
			// no session
			return makeAnError(new Error('No session'), callback);
		}
		
		var items = [];
		
		// prepare to execute the script in the page
		var UserYou;
		function BuildHover(str, item) {
			items.push(item);
		}
		function $() {
			return {
				show: function() {}
			};
		}
		
		// evil magic happens here
		eval(script[1]);
		
		callback(null, items);
	});
};


function makeAnError(error, callback) {
	if(callback) {
		callback(error);
	}
}
