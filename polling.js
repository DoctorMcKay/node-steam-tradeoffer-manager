var TradeOfferManager = require('./index.js');
var EOfferFilter = TradeOfferManager.EOfferFilter;

TradeOfferManager.prototype._doPoll = function() {
	clearTimeout(this._pollTimer);
	
	this.emit('debug', 'Doing trade offer poll since ' + this.pollData.offersSince);
	this.getOffers(EOfferFilter.ActiveOnly, new Date(this.pollData.offersSince * 1000), function(err, sent, received) {
		if(err) {
			this.emit('debug', "Error getting trade offers for poll: " + err.message);
			this._pollTimer = setTimeout(this._doPoll.bind(this), this._pollInterval);
			return;
		}
		
		var offers = this.pollData.sent || {};
		
		sent.forEach(function(offer) {
			if(offers[offer.id] && offer.state != offers[offer.id]) {
				this.emit('sentOfferChanged', offer, offers[offer.id]);
				offers[offer.id] = offer.state;
			}
			
			offers[offer.id] = offer.state;
		}.bind(this));
		
		this.pollData.sent = offers;
		offers = this.pollData.received || {};
		
		received.forEach(function(offer) {
			if(!offers[offer.id]) {
				this.emit('newOffer', offer);
			} else if(offer.state != offers[offer.id]) {
				this.emit('receivedOfferChanged', offer, offers[offer.id]);
			}
			
			offers[offer.id] = offer.state;
		}.bind(this));
		
		this.pollData.received = offers;
		
		// Find the latest update time
		var latest = 0;
		sent.concat(received).forEach(function(offer) {
			var updated = Math.floor(offer.updated.getTime() / 1000);
			if(updated > latest) {
				latest = updated;
			}
		});
		
		this.pollData.offersSince = latest;
		this.emit('pollData', this.pollData);
		
		this._pollTimer = setTimeout(this._doPoll.bind(this), this._pollInterval);
	}.bind(this));
};
