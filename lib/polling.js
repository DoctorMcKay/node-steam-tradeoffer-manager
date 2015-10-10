var TradeOfferManager = require('./index.js');
var ETradeOfferState = TradeOfferManager.ETradeOfferState;
var EOfferFilter = TradeOfferManager.EOfferFilter;
var deepEqual = require('deep-equal');
var clone = require('clone');

TradeOfferManager.prototype.doPoll = function() {
	if(Date.now() - this._lastPoll < 1000) {
		// We last polled less than a second ago, don't spam the API
		// Reset the timer to poll one second after the last one
		this._resetPollTimer(Date.now() - this._lastPoll);
		return;
	}
	
	this._lastPoll = Date.now();
	clearTimeout(this._pollTimer);

	var offersSince = 0;
	if(this.pollData.offersSince) {
		// It looks like sometimes Steam can be dumb and backdate a modified offer. We need to handle this.
		// Let's add a 5-minute buffer.
		offersSince = this.pollData.offersSince - 300;
	}
	
	this.emit('debug', 'Doing trade offer poll since ' + offersSince);
	this.getOffers(EOfferFilter.ActiveOnly, new Date(offersSince * 1000), function(err, sent, received) {
		if(err) {
			this.emit('debug', "Error getting trade offers for poll: " + err.message);
			this.emit('pollFailure', err);
			this._resetPollTimer();
			return;
		}

		var origPollData = clone(this.pollData);
		
		var offers = this.pollData.sent || {};
		
		sent.forEach(function(offer) {
			if(offers[offer.id] && offer.state != offers[offer.id]) {
				this.emit('sentOfferChanged', offer, offers[offer.id]);
				offers[offer.id] = offer.state;
			} else if(this.cancelTime && offer.state == ETradeOfferState.Active && (Date.now() - offer.created.getTime() >= this.cancelTime)) {
				offer.cancel(function(err) {
					if(!err) {
						this.emit('sentOfferCanceled', offer);
					}
				}.bind(this));
			}
			
			offers[offer.id] = offer.state;
		}.bind(this));
		
		this.pollData.sent = offers;
		offers = this.pollData.received || {};
		
		received.forEach(function(offer) {
			if(!offers[offer.id] && offer.state == ETradeOfferState.Active) {
				this.emit('newOffer', offer);
			} else if(offers[offer.id] && offer.state != offers[offer.id]) {
				this.emit('receivedOfferChanged', offer, offers[offer.id]);
			}
			
			offers[offer.id] = offer.state;
		}.bind(this));
		
		this.pollData.received = offers;
		
		// Find the latest update time
		var latest = this.pollData.offersSince || 0;
		sent.concat(received).forEach(function(offer) {
			var updated = Math.floor(offer.updated.getTime() / 1000);
			if(updated > latest) {
				latest = updated;
			}
		});
		
		this.pollData.offersSince = latest;
		this.emit('debug', 'Latest offer modification time is ' + latest);
		
		// Check if any offers which we want to accept are still Active
		if(this.pollData.toAccept) {
			var offer, offerID, lastAttempt;
			for(offerID in this.pollData.toAccept) {
				offer = received.filter(function(item) {
					return item.id == offerID;
				});
				
				if(!offer[0] || offer[0].state != ETradeOfferState.Active) {
					// It's no longer active, so we're done here
					delete this.pollData.toAccept[offerID];
					continue;
				}
				
				if(Date.now() - this.pollData.toAccept[offerID] > 60000) {
					// We last tried to accept this offer over a minute ago. Try again.
					this.pollData.toAccept[offerID] = Date.now();
					offer[0].accept();
				}
			}
		}

		this.emit('pollSuccess');

		// If something has changed, emit the event
		if(!deepEqual(origPollData, this.pollData)) {
			this.emit('pollData', this.pollData);
		}
		
		this._resetPollTimer();
	}.bind(this));
};

TradeOfferManager.prototype._resetPollTimer = function(time) {
	if(time || this.pollInterval >= 1000) {
		clearTimeout(this._pollTimer);
		this._pollTimer = setTimeout(this.doPoll.bind(this), time || this.pollInterval);
	}
};
