"use strict";

var TradeOfferManager = require('./index.js');
var ETradeOfferState = TradeOfferManager.ETradeOfferState;
var EOfferFilter = TradeOfferManager.EOfferFilter;
var EConfirmationMethod = TradeOfferManager.EConfirmationMethod;
var deepEqual = require('deep-equal');
var clone = require('clone');

/*
 * pollData is an object which has the following structure:
 *  - `offersSince` is the STANDARD unix time (Math.floor(Date.now() / 1000)) of the last known offer change
 *  - `sent` is an object whose keys are offer IDs for known offers we've sent and whose values are the last known states of those offers
 *  - `received` is the same as `sent`, for offers we've received
 *  - `offerData` is an object whose keys are offer IDs. Values are objects mapping arbitrary keys to arbitrary values.
 *    Some keys are reserved for offer-specific options. These are:
 *  	- `cancelTime` - The time, in milliseconds, after which the offer should be canceled automatically. Defaults to the TradeOfferManager's set cancelTime.
 *      - `pendingCancelTime` - Ditto `cancelTime`, except only for offers which are CreatedNeedsConfirmation.
 */

TradeOfferManager.prototype.doPoll = function() {
	if (this.hasShutDown) {
		// In case a race condition causes this to be called after we've shutdown
		return;
	}

	if (!this.apiKey || Date.now() - this._lastPoll < 1000) {
		// Either we don't have an API key, or we last polled less than a second ago... we shouldn't spam the API
		// Reset the timer to poll one second after the last one
		this._resetPollTimer(Date.now() - this._lastPoll);
		return;
	}

	this._lastPoll = Date.now();
	clearTimeout(this._pollTimer);

	var offersSince = 0;
	if (this.pollData.offersSince) {
		// It looks like sometimes Steam can be dumb and backdate a modified offer. We need to handle this.
		// Let's add a 30-minute buffer.
		offersSince = this.pollData.offersSince - 1800;
	}

	var fullUpdate = false;
	if (Date.now() - this._lastPollFullUpdate >= 120000) {
		fullUpdate = true;
		this._lastPollFullUpdate = Date.now();
		offersSince = 1;
	}

	this.emit('debug', 'Doing trade offer poll since ' + offersSince + (fullUpdate ? ' (full update)' : ''));
	this.getOffers(fullUpdate ? EOfferFilter.All : EOfferFilter.ActiveOnly, new Date(offersSince * 1000), (err, sent, received) => {
		if (err) {
			this.emit('debug', "Error getting trade offers for poll: " + err.message);
			this.emit('pollFailure', err);
			this._resetPollTimer();
			return;
		}

		var origPollData = clone(this.pollData);

		/*if (fullUpdate) {
			// We can only purge stuff if this is a full update; otherwise, lack of an offer's presence doesn't mean Steam forgot about it
			var trackedIds = sent.map(offerId).concat(received.map(offerId)); // OfferIDs that are active in Steam's memory
			var oldIds = Object.keys(this.pollData.sent || {}).concat(Object.keys(this.pollData.received || {})); // OfferIDs that we have in our poll data

			// This routine won't delete any offers that we last saw as Active. If it changed state and we didn't see it,
			// it'll stick around forever. Perhaps someday we should account for this as well; e.g. by clearing offers
			// with super super low IDs relative to the current ID.

			oldIds.forEach((offerID) => {
				if (trackedIds.indexOf(offerID) == -1) {
					// This offer is no longer in Steam's memory. Let's clean it up.
					var found = false;

					var offerAgeDays = this.pollData.timestamps && this.pollData.timestamps[offerID] ? (Date.now() - this.pollData.timestamps[offerID]) / (1000 * 60 * 60 * 24) : null;

					if (offerAgeDays && offerAgeDays <= 30) {
						return; // it's too new to clean up
					}

					if (this.pollData.sent && this.pollData.sent[offerID] && (this.pollData.sent[offerID] != ETradeOfferState.Active || (offerAgeDays && offerAgeDays > 30))) {
						found = found || delete this.pollData.sent[offerID];
					}

					if (this.pollData.received && this.pollData.received[offerID] && (this.pollData.received[offerID] != ETradeOfferState.Active || (offerAgeDays && offerAgeDays > 30))) {
						found = found || delete this.pollData.received[offerID];
					}

					if (found) {
						this.emit('debug', "Cleaning up stale offer #" + offerID + " from poll data");
					}
				}
			});

			var knownTimestamps = Object.keys(this.pollData.timestamps || {});
			knownTimestamps.forEach((offerID) => {
				var isSent = this.pollData.sent && this.pollData.sent[offerID];
				var isReceived = this.pollData.received && this.pollData.received[offerID];

				if (!isSent && !isReceived && Date.now() - this.pollData.timestamps[offerID] >= (1000 * 60 * 60 * 24 * 60)) {
					this.emit('debug', "Cleaning up stale timestamp " + this.pollData.timestamps[offerID] + " for offer " + offerID + " from poll data");
					delete this.pollData.timestamps[offerID];
				}
			});
		}*/

		var timestamps = this.pollData.timestamps || {};
		var offers = this.pollData.sent || {};
		var hasGlitchedOffer = false;

		sent.forEach((offer) => {
			if (!offers[offer.id]) {
				// We sent this offer, but we have no record of it! Good job Steam
				// Apparently offers can appear in the API before the send() call has returned, so we'll need to add a delay
				// Only emit the unknownOfferSent event if currently there's no offers that await a response in .send
				if (!this._pendingOfferSendResponses) {
					if (offer.fromRealTimeTrade) {
						// This is a real-time trade offer.
						if (offer.state == ETradeOfferState.CreatedNeedsConfirmation || (offer.state == ETradeOfferState.Active && offer.confirmationMethod != EConfirmationMethod.None)) {
							// we need to confirm this
							this.emit('realTimeTradeConfirmationRequired', offer);
						} else if (offer.state == ETradeOfferState.Accepted) {
							// both parties confirmed, trade complete
							this.emit('realTimeTradeCompleted', offer);
						}
					}

					this.emit('unknownOfferSent', offer);
					offers[offer.id] = offer.state;
					timestamps[offer.id] = offer.created.getTime() / 1000;
				}
			} else if (offer.state != offers[offer.id]) {
				if (!offer.isGlitched()) {
					// We sent this offer, and it has now changed state
					if (offer.fromRealTimeTrade && offer.state == ETradeOfferState.Accepted) {
						this.emit('realTimeTradeCompleted', offer);
					}

					this.emit('sentOfferChanged', offer, offers[offer.id]);
					offers[offer.id] = offer.state;
					timestamps[offer.id] = offer.created.getTime() / 1000;
				} else {
					hasGlitchedOffer = true;
					var countWithoutName = !this._language ? 0 : offer.itemsToGive.concat(offer.itemsToReceive).filter(function(item) { return !item.name; }).length;
					this.emit('debug', "Not emitting sentOfferChanged for " + offer.id + " right now because it's glitched (" +
						offer.itemsToGive.length + " to give, " + offer.itemsToReceive.length + " to receive, " + countWithoutName + " without name)");
				}
			}

			if (offer.state == ETradeOfferState.Active) {
				// The offer is still Active, and we sent it. See if it's time to cancel it automatically.
				var cancelTime = this.cancelTime;

				// Check if this offer has a custom cancelTime
				var customCancelTime = offer.data('cancelTime');
				if (typeof customCancelTime !== 'undefined') {
					cancelTime = customCancelTime;
				}

				if (cancelTime && (Date.now() - offer.updated.getTime() >= cancelTime)) {
					offer.cancel((err) => {
						if (!err) {
							this.emit('sentOfferCanceled', offer, 'cancelTime');
						} else {
							this.emit('debug', "Can't auto-cancel offer #" + offer.id + ": " + err.message);
						}
					});
				}
			}

			if (offer.state == ETradeOfferState.CreatedNeedsConfirmation && this.pendingCancelTime) {
				// The offer needs to be confirmed to be sent. Let's see if the maximum time has elapsed before we cancel it.
				var pendingCancelTime = this.pendingCancelTime;

				var customPendingCancelTime = offer.data('pendingCancelTime');
				if (typeof customPendingCancelTime !== 'undefined') {
					pendingCancelTime = customPendingCancelTime;
				}

				if (pendingCancelTime && (Date.now() - offer.created.getTime() >= pendingCancelTime)) {
					offer.cancel((err) => {
						if (!err) {
							this.emit('sentPendingOfferCanceled', offer);
						} else {
							this.emit('debug', "Can't auto-canceling pending-confirmation offer #" + offer.id + ": " + err.message);
						}
					});
				}
			}
		});

		if (this.cancelOfferCount) {
			var sentActive = sent.filter(offer => offer.state == ETradeOfferState.Active);

			if (sentActive.length >= this.cancelOfferCount) {
				// We have too many offers out. Let's cancel the oldest.
				// Use updated since that reflects when it was confirmed, if necessary.
				var oldest = sentActive[0];
				for (var i = 1; i < sentActive.length; i++) {
					if (sentActive[i].updated.getTime() < oldest.updated.getTime()) {
						oldest = sentActive[i];
					}
				}

				// Make sure it's old enough
				if (Date.now() - oldest.updated.getTime() >= this.cancelOfferCountMinAge) {
					oldest.cancel((err) => {
						if (!err) {
							this.emit('sentOfferCanceled', oldest, 'cancelOfferCount');
						}
					});
				}
			}
		}

		this.pollData.sent = offers;
		offers = this.pollData.received || {};

		received.forEach((offer) => {
			if (offer.isGlitched()) {
				hasGlitchedOffer = true;
				return;
			}

			if (offer.fromRealTimeTrade) {
				// This is a real-time trade offer
				if (!offers[offer.id] && (offer.state == ETradeOfferState.CreatedNeedsConfirmation || (offer.state == ETradeOfferState.Active && offer.confirmationMethod != EConfirmationMethod.None))) {
					this.emit('realTimeTradeConfirmationRequired', offer);
				} else if (offer.state == ETradeOfferState.Accepted && (!offers[offer.id] || (offers[offer.id] != offer.state))) {
					this.emit('realTimeTradeCompleted', offer);
				}
			}

			if (!offers[offer.id] && offer.state == ETradeOfferState.Active) {
				this.emit('newOffer', offer);
			} else if (offers[offer.id] && offer.state != offers[offer.id]) {
				this.emit('receivedOfferChanged', offer, offers[offer.id]);
			}

			offers[offer.id] = offer.state;
			timestamps[offer.id] = offer.created.getTime() / 1000;
		});

		this.pollData.received = offers;
		this.pollData.timestamps = timestamps;

		// Find the latest update time
		if (!hasGlitchedOffer) {
			var latest = this.pollData.offersSince || 0;
			sent.concat(received).forEach((offer) => {
				var updated = Math.floor(offer.updated.getTime() / 1000);
				if (updated > latest) {
					latest = updated;
				}
			});

			this.pollData.offersSince = latest;
		}

		this.emit('pollSuccess');

		// If something has changed, emit the event
		if (!deepEqual(origPollData, this.pollData)) {
			this.emit('pollData', this.pollData);
		}

		this._resetPollTimer();
	});
};

function offerId(offer) {
	return String(offer.id);
}

TradeOfferManager.prototype._resetPollTimer = function(time) {
	if (time || this.pollInterval >= 1000) {
		clearTimeout(this._pollTimer);
		this._pollTimer = setTimeout(this.doPoll.bind(this), time || this.pollInterval);
	}
};
