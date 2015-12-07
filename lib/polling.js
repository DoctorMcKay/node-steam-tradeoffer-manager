var TradeOfferManager = require('./index.js');
var ETradeOfferState = TradeOfferManager.ETradeOfferState;
var EOfferFilter = TradeOfferManager.EOfferFilter;
var deepEqual = require('deep-equal');
var clone = require('clone');

/*
 * pollData is an object which has the following structure:
 *  - `offersSince` is the STANDARD unix time (Math.floor(Date.now() / 1000)) of the last known offer change
 *  - `sent` is an object whose keys are offer IDs for known offers we've sent and whose values are the last known states of those offers
 *  - `received` is the same as `sent`, for offers we've received
 *  - `toAccept` is an object whose keys are offer IDs for offers we've tried to accept, but Steam failed. Values are JavaScript unix times (in milliseconds) of the last time when we attempted to accept.
 *  - `offerData` is an object whose keys are offer IDs. Values are objects mapping arbitrary keys to arbitrary values.
 *    Some keys are reserved for offer-specific options. These are:
 *  	- `cancelTime` - The time, in milliseconds, after which the offer should be canceled automatically. Defaults to the TradeOfferManager's set cancelTime.
 */

TradeOfferManager.prototype.doPoll = function() {
	if(!this.apiKey || Date.now() - this._lastPoll < 1000) {
		// Either we don't have an API key, or we last polled less than a second ago... we shouldn't spam the API
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
			if(!offers[offer.id]) {
				// We sent this offer, but we have no record of it! Good job Steam
				// Apparently offers can appear in the API before the send() call has returned, so we'll need to add a delay
				if(Date.now() - offer.created.getTime() > 3000) {
					this.emit('unknownOfferSent', offer);
					offers[offer.id] = offer.state;
				}
			} else if(offers[offer.id] && offer.state != offers[offer.id]) {
				// We sent this offer, and it has now changed state
				this.emit('sentOfferChanged', offer, offers[offer.id]);
				offers[offer.id] = offer.state;
			}

			if(offer.state == ETradeOfferState.Active) {
				// The offer is still Active, and we sent it. See if it's time to cancel it automatically.
				var cancelTime = this.cancelTime;

				// Check if this offer has a custom cancelTime
				var customCancelTime = offer.data('cancelTime');
				if(typeof customCancelTime !== 'undefined') {
					cancelTime = customCancelTime;
				}

				if(cancelTime && (Date.now() - offer.updated.getTime() >= cancelTime)) {
					offer.cancel(function(err) {
						if(!err) {
							this.emit('sentOfferCanceled', offer);
						}
					}.bind(this));
				}
			}

			if(offer.state == ETradeOfferState.CreatedNeedsConfirmation && this.pendingCancelTime) {
				// The offer needs to be confirmed to be sent. Let's see if the maximum time has elapsed before we cancel it.
				var pendingCancelTime = this.pendingCancelTime;

				var customPendingCancelTime = offer.data('pendingCancelTime');
				if(typeof customPendingCancelTime !== 'undefined') {
					pendingCancelTime = customPendingCancelTime;
				}

				if(pendingCancelTime && (Date.now() - offer.created.getTime() >= pendingCancelTime))  {
					offer.cancel(function(err) {
						if(!err) {
							this.emit('sentPendingOfferCanceled', offer);
						}
					}.bind(this));
				}
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
			var offer, offerID;
			for(offerID in this.pollData.toAccept) {
				offer = received.filter(function(item) {
					return item.id == offerID;
				});
				
				if(!offer[0] || offer[0].state != ETradeOfferState.Active) {
					// It's no longer active, so we're done here
					delete this.pollData.toAccept[offerID];
					continue;
				}

				// The value of this.pollData.toAccept[offerID] is the unix time in milliseconds when we last tried to accept it
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
