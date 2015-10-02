var TradeOfferManager = require('../index.js');
var SteamID = require('steamid');
var EconItem = require('./EconItem.js');

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
			callback(err);
			return;
		}
		
		if(!body.response) {
			callback(new Error("Malformed API response"));
			return;
		}
		
		if(!body.response.offer) {
			callback(new Error("No matching offer found"));
			return;
		}
		
		manager._digestDescriptions(body.response.descriptions);
		checkNeededDescriptions(manager, [body.response.offer], function(err) {
			if(err) {
				callback(err);
				return;
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
	
	// Currently the GetTradeOffers API doesn't include app_data, so we need to get descriptions from the WebAPI
	
	var options = {
		"get_sent_offers": 1,
		"get_received_offers": 1,
		"get_descriptions": 0/*this._language ? 1 : 0*/,
		"language": this._language,
		"active_only": (filter == EOfferFilter.ActiveOnly || filter == EOfferFilter.All) ? 1 : 0,
		"historical_only": (filter == EOfferFilter.HistoricalOnly || filter == EOfferFilter.All) ? 1 : 0,
		"time_historical_cutoff": Math.floor(historicalCutoff.getTime() / 1000)
	};
	
	var manager = this;
	this._apiCall('GET', 'GetTradeOffers', 1, options, function(err, body) {
		if(err) {
			callback(err);
			return;
		}
		
		if(!body.response) {
			callback(new Error("Malformed API response"));
			return;
		}
		
		//manager._digestDescriptions(body.response.descriptions);

		// Let's check the asset cache and see if we have descriptions that match these items.
		// If the necessary descriptions aren't in the asset cache, this will request them from the WebAPI and store
		// them for future use.
		checkNeededDescriptions(manager, (body.response.trade_offers_sent || []).concat(body.response.trade_offers_received || []), function(err) {
			if(err) {
				callback(err);
				return;
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
	offer.id = data.tradeofferid.toString();
	offer.message = data.message;
	offer.state = data.trade_offer_state;
	offer.itemsToGive = data.items_to_give || [];
	offer.itemsToReceive = data.items_to_receive || [];
	offer.isOurOffer = data.is_our_offer;
	offer.created = new Date(data.time_created * 1000);
	offer.updated = new Date(data.time_updated * 1000);
	offer.expires = new Date(data.expiration_time * 1000);
	offer.tradeID = data.tradeid ? data.tradeid.toString() : null;
	offer.fromRealTimeTrade = data.from_real_time_trade;
	
	if(manager._language) {
		offer.itemsToGive = manager._mapItemsToDescriptions(null, null, offer.itemsToGive);
		offer.itemsToReceive = manager._mapItemsToDescriptions(null, null, offer.itemsToReceive);
	} else {
		offer.itemsToGive = processItems(offer.itemsToGive);
		offer.itemsToReceive = processItems(offer.itemsToReceive);
	}
	
	return offer;
}

function processItems(items) {
	return items.map(function(item) {
		return new EconItem(item);
	})
}

function checkNeededDescriptions(manager, offers, callback) {
	if(!manager._language) {
		callback();
		return;
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
		callback();
		return;
	}
	
	manager._requestDescriptions(items, callback);
}

function TradeOffer(manager, partner) {
	if(partner instanceof SteamID) {
		this.partner = partner;
	} else {
		this.partner = new SteamID(partner);
	}
	this._countering = null;

	this.manager = manager;
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

TradeOffer.prototype.loadPartnerInventory = function(appid, contextid, callback) {
	this.manager._community.getUserInventory(this.partner, appid, contextid, true, callback);
};

TradeOffer.prototype.addMyItem = function(item) {
	addItem(item, this, this.itemsToGive);
};

TradeOffer.prototype.addMyItems = function(items) {
	items.forEach(this.addMyItem.bind(this));
};

TradeOffer.prototype.removeMyItem = function(item) {
	if(this.id) {
		throw new Error("Cannot remove items from an already-sent offer");
	}

	for(var i = 0; i < this.itemsToGive.length; i++) {
		if(itemEquals(this.itemsToGive[i], item)) {
			this.itemsToGive.splice(i, 1);
			return true;
		}
	}

	return false;
};

TradeOffer.prototype.removeMyItems = function(items) {
	var removed = 0;
	var self = this;
	items.forEach(function(item) {
		if(self.removeMyItem(item)) {
			removed++;
		}
	});

	return removed;
};

TradeOffer.prototype.addTheirItem = function(item) {
	addItem(item, this, this.itemsToReceive);
};

TradeOffer.prototype.addTheirItems = function(items) {
	items.forEach(this.addTheirItem.bind(this));
};

TradeOffer.prototype.removeTheirItem = function(item) {
	if(this.id) {
		throw new Error("Cannot remove items from an already-sent offer");
	}
	
	for(var i = 0; i < this.itemsToReceive.length; i++) {
		if(itemEquals(this.itemsToReceive[i], item)) {
			this.itemsToReceive.splice(i, 1);
			return true;
		}
	}

	return false;
};

TradeOffer.prototype.removeTheirItems = function(items) {
	var removed = 0;
	var self = this;
	items.forEach(function(item) {
		if(self.removeTheirItem(item)) {
			removed++;
		}
	});

	return removed;
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
	
	if(typeof item.appid === 'undefined' || typeof item.contextid === 'undefined' || typeof item.assetid === 'undefined') {
		throw new Error("Missing appid, contextid, or assetid parameter");
	}
	
	if(list.some(function(tradeItem) { itemEquals(tradeItem, item); })) {
		// Already in trade
		return;
	}
	
	list.push(item);
}

function itemEquals(a, b) {
	return a.appid == b.appid && a.contextid == b.contextid && (a.assetid || a.id) == (b.assetid || b.id);
}

TradeOffer.prototype.send = function(message, token, callback) {
	if(this.id) {
		makeAnError(new Error("This offer has already been sent"), callback);
		return;
	}
	
	message = message || '';
	
	if(typeof token === 'function') {
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
	
	this.manager._request.post('https://steamcommunity.com/tradeoffer/new/send', {
		"headers": {
			"referer": "https://steamcommunity.com/tradeoffer/" + (this.id || 'new') + "/?partner=" + this.partner.accountid + (token ? "&token=" + token : '')
		},
		"json": true,
		"form": {
			"sessionid": this.manager._community.getSessionID(),
			"serverid": 1,
			"partner": this.partner.toString(),
			"tradeoffermessage": message,
			"json_tradeoffer": JSON.stringify(offerdata),
			"captcha": '',
			"trade_offer_create_params": JSON.stringify(params),
			"tradeofferid_countered": this._countering
		}
	}, function(err, response, body) {
		if(err || response.statusCode != 200) {
			makeAnError(err || new Error("HTTP error " + response.statusCode), callback, body);
			return;
		}
		
		if(body && body.strError) {
			makeAnError(null, callback, body);
			return;
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
		
		this.manager.pollData.sent = this.manager.pollData.sent || {};
		this.manager.pollData.sent[this.id] = this.state;
		this.manager.emit('pollData', this.manager.pollData);
		
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
		makeAnError(new Error("Cannot cancel or decline an unsent offer"), callback);
		return;
	}
	
	if(this.state != ETradeOfferState.Active) {
		makeAnError(new Error("Offer #" + this.id + " is not active, so it may not be cancelled or declined"), callback);
		return;
	}
	
	this.manager._apiCall('POST', this.isOurOffer ? 'CancelTradeOffer' : 'DeclineTradeOffer', 1, {"tradeofferid": this.id}, function(err, body) {
		if(err) {
			makeAnError(err, callback);
		}
		
		this.updated = new Date();
		
		if(callback) {
			callback();
		}
		
		this.manager.doPoll();
	}.bind(this));
};

TradeOffer.prototype.decline = function(callback) {
	// Alias of cancel
	this.cancel(callback);
};

TradeOffer.prototype.accept = function(autoRetry, callback) {
	if(typeof autoRetry === 'function') {
		callback = autoRetry;
		autoRetry = true;
	}
	
	if(!this.id) {
		makeAnError(new Error("Cannot accept an unsent offer"), callback);
		return;
	}
	
	if(this.state != ETradeOfferState.Active) {
		makeAnError(new Error("Offer #" + this.id + " is not active, so it may not be accepted"), callback);
		return;
	}
	
	if(this.isOurOffer) {
		makeAnError(new Error("Cannot accept our own offer #" + this.id), callback);
		return;
	}
	
	this.manager._request.post('https://steamcommunity.com/tradeoffer/' + this.id + '/accept', {
		"headers": {
			"referer": 'https://steamcommunity.com/tradeoffer/' + this.id + '/'
		},
		"json": true,
		"form": {
			"sessionid": this.manager._community.getSessionID(),
			"serverid": 1,
			"tradeofferid": this.id,
			"partner": this.partner.toString(),
			"captcha": ""
		}
	}, function(err, response, body) {
		if(err || response.statusCode != 200) {
			if(autoRetry !== false) {
				addAcceptToPollData(this.manager, this.id);
			}
			
			makeAnError(err || new Error("HTTP error " + response.statusCode), callback, body);
			return;
		}
		
		if(body && body.strError) {
			var error = makeAnError(null, callback, body);
			if(!error.cause && autoRetry !== false) {
				addAcceptToPollData(this.manager, this.id);
			}

			return;
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
			this.tradeID = body.tradeid;
			callback(null, 'accepted');
			
			this.manager.doPoll();
		} else {
			callback(new Error("Unknown response"));
		}
	}.bind(this));
};

function addAcceptToPollData(manager, offerID) {
	manager.pollData = manager.pollData || {};
	manager.pollData.toAccept = manager.pollData.toAccept || {};
	manager.pollData.toAccept[offerID] = Date.now();
	manager.emit('pollData', manager.pollData);
}

TradeOffer.prototype.getReceivedItems = function(callback) {
	if(!this.id) {
		makeAnError(new Error("Cannot request received items on an unsent offer"), callback);
		return;
	}
	
	if(this.state != ETradeOfferState.Accepted) {
		makeAnError(new Error("Offer #" + this.id + " is not accepted, cannot request received items"), callback);
		return;
	}
	
	if(!this.tradeID) {
		makeAnError(new Error("Offer #" + this.id + " is accepted, but does not have a trade ID"), callback);
		return;
	}
	
	// Borrowed from node-steam-trade (https://github.com/seishun/node-steam-trade/blob/master/index.js#L86-L119)
	this.manager._request('https://steamcommunity.com/trade/' + this.tradeID + '/receipt/', function(err, response, body) {
		if(err || response.statusCode != 200) {
			makeAnError(err || new Error("HTTP error " + response.statusCode), callback);
			return;
		}
		
		var script = body.match(/(var oItem;[\s\S]*)<\/script>/);
		if(!script) {
			// no session
			makeAnError(new Error('No session'), callback);
			return;
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

		items = items.map(function(item) {
			return new EconItem(item);
		});
		
		callback(null, items);
	});
};

TradeOffer.prototype.counter = function() {
	if(this.state != ETradeOfferState.Active) {
		throw new Error("Cannot counter a non-active offer.");
	}
	
	var offer = new TradeOffer(this.manager, this.partner);
	
	offer._countering = this.id;
	offer.itemsToGive = this.itemsToGive.slice();
	offer.itemsToReceive = this.itemsToReceive.slice();
	offer.isOurOffer = true;
	offer.fromRealTimeTrade = false;
	return offer;
};

function makeAnError(error, callback, body) {
	if(callback) {
		if(body && body.strError) {
			error = new Error(body.strError);
			
			var match = body.strError.match(/\((\d+)\)$/);
			if(match) {
				error.eresult = parseInt(match[1], 10);
			}

			if(body.strError.match(/they have a trade ban/)) {
				error.cause = 'TradeBan';
			}

			if(body.strError.match(/logged in from a new device/)) {
				error.cause = 'NewDevice';
			}

			if(body.strError.match(/not available to trade/)) {
				error.cause = 'TargetCannotTrade';
			}
			
			callback(error);

			return error;
		} else {
			callback(error);
			return error;
		}
	}

	return null;
}
