"use strict";

// External modules
const EventEmitter = require('events').EventEmitter;
const StdLib = require('@doctormckay/stdlib');
const Util = require('util');

// Internal modules/classes
const SteamID = require('steamid');
const EconItem = require('./EconItem.js');
const Helpers = require('../helpers.js');
const TradeOfferManager = require('../index.js');

// Resources
const ETradeSessionAction = require('../../resources/ETradeSessionAction.js');
const ETradeSessionStatus = require('../../resources/ETradeSessionStatus.js');

Util.inherits(TradeSession, EventEmitter);

/**
 * Open a started real-time trade session. TradeOfferManager cannot *start* a trade session, it can only open one.
 * To start a trade session, see the `trade` method of `steam-user` (https://www.npmjs.com/package/steam-user).
 * @param {string|SteamID} partner
 * @param {function} callback - First arg is {Error|null}, second is a {TradeSession}
 */
TradeOfferManager.prototype.openTradeSession = function(partner, callback) {
	if (typeof partner === 'string') {
		partner = new SteamID(partner);
	}

	Helpers.getUserDetailsFromTradeWindow(this, `https://steamcommunity.com/trade/${partner.getSteamID64()}`, (err, me, them) => {
		if (err) {
			callback(err);
			return;
		}

		callback(null, new TradeSession(this, partner, me, them));
	});
};

function TradeSession(manager, partner, detailsMe, detailsThem) {
	if (typeof partner === 'string') {
		this.partner = new SteamID(partner);
	} else {
		this.partner = partner;
	}

	this.itemsToGive = [];
	this._itemsToGiveRemoving = [];
	this.itemsToReceive = [];

	this.me = detailsMe;
	this.them = detailsThem;

	this.me.ready = false;
	this.me.confirmed = false;
	this.them.ready = false;
	this.them.confirmed = false;

	this.pollInterval = 1000; // ms

	this._manager = manager;
	this._pollInFlight = false;
	this._ignoreNextPoll = false;
	this._ended = false;
	this._statusFailures = 0;
	this._version = 1;
	this._logPos = 0;
	this._tradeStatusPoll = null;
	this._myInventory = {};
	this._myInventoryLoading = {};
	this._myItemsInTradeOrder = [];
	this._theirInventory = {};
	this._theirInventoryLoading = {};
	this._theirItemsInTradeOrder = [];
	this._usedSlots = [];
	this._cmdQueue = new StdLib.DataStructures.AsyncQueue((cmd, callback) => {
		this._doCommand(cmd.command, cmd.args || {}, cmd.tryCount, callback);
	});

	this._enqueueTradeStatusPoll();
}

/**
 * Get the contents of your own inventory. Identical to TradeOfferManager's getInventoryContents, but you should use this
 * because it populates the local trade session cache.
 * @param {int} appid
 * @param {int} contextid
 * @param {function} callback
 */
TradeSession.prototype.getInventory = function(appid, contextid, callback) {
	let invKey = `${appid}_${contextid}`;
	if (this._myInventory[invKey]) {
		callback(null, this._myInventory[invKey]);
		return;
	}

	if (this._myInventoryLoading[invKey]) {
		this._myInventoryLoading[invKey].push(callback);
		return;
	}

	this._myInventoryLoading[invKey] = [];

	let doAttempt = (attemptNum) => {
		if (attemptNum > 3) {
			let err = new Error(`Cannot get our inventory for appid ${appid} contextid ${contextid}`);
			callback(err);
			this._myInventoryLoading[invKey].forEach(cb => cb(err));
			return;
		}

		this.emit('debug', 'Getting our inventory ' + invKey);
		this._manager.getInventoryContents(appid, contextid, true, (err, inv) => {
			if (err) {
				this.emit('debug', 'Cannot get my inventory: ' + err.message);
				setTimeout(() => doAttempt(attemptNum + 1), 500);
				return;
			}

			this._myInventory[invKey] = inv;
			callback(null, inv);
			this._myInventoryLoading[invKey].forEach(cb => cb(null, inv));
		});
	};

	doAttempt(1);
};

/**
 * Set yourself as ready (check the blue box).
 * @param {function} [callback] - Just gets an error
 */
TradeSession.prototype.ready = function(callback) {
	this._cmdQueue.push({
		"command": "toggleready",
		"args": {
			"ready": "true"
		},
		"tryCount": 5
	}, callback);
};

/**
 * Set yourself as not ready (uncheck the blue box).
 * @param {function} [callback] - Just gets an error
 */
TradeSession.prototype.unready = function(callback) {
	this._cmdQueue.push({
		"command": "toggleready",
		"args": {
			"ready": "false"
		},
		"tryCount": 5
	}, callback);
};

/**
 * Confirm the trade. Only has an effect if both parties are readied up.
 * @param {function} [callback] - Just gets an error
 */
TradeSession.prototype.confirm = function(callback) {
	this._cmdQueue.push({
		"command": "confirm",
		"tryCount": 5
	}, callback);
};

/**
 * Send a chat message. This is enqueued and sent one at a time, so it's safe to call this multiple times in rapid succession.
 * @param {string} msg
 * @param {function} [callback] - Just gets an error
 */
TradeSession.prototype.chat = function(msg, callback) {
	this._cmdQueue.push({
		"command": "chat",
		"args": {
			"message": msg
		},
		"tryCount": 3
	}, callback);
};

/**
 * Adds an item to the trade. The trade is terminated if this fails.
 * @param {object} item - Needs to have properties: appid, contextid, and either assetid or id
 * @param {function} [callback] - Just gets an error
 */
TradeSession.prototype.addItem = function(item, callback) {
	this._cmdQueue.push({
		"command": "additem",
		"args": {
			"appid": item.appid,
			"contextid": item.contextid,
			"itemid": item.assetid || item.id,
			"slot": this._getNextSlot()
		},
		"tryCount": 5
	}, (err) => {
		if (err) {
			callback && callback(err);
			this._terminateWithError(`Cannot add item ${item.appid}_${item.contextid}_${item.assetid || item.id} to trade`);
		} else {
			callback && callback(null);
		}
	});

	let cloned = shallowClone(item);
	cloned.pendingAdd = true;
	this.itemsToGive.push(cloned);
};

/**
 * Removes an item from the trade. The trade is terminated if this fails.
 * @param {object} item - Needs to have properties: appid, contextid, and either assetid or id
 * @param {function} [callback] - Just gets an error
 */
TradeSession.prototype.removeItem = function(item, callback) {
	this._cmdQueue.push({
		"command": "removeitem",
		"args": {
			"appid": item.appid,
			"contextid": item.contextid,
			"itemid": item.assetid || item.id
		},
		"tryCount": 5
	}, (err) => {
		if (err) {
			callback && callback(err);
			this._terminateWithError(`Cannot remove item ${item.appid}_${item.contextid}_${item.assetid || item.id} from trade`);
		} else {
			callback && callback(null);
		}
	});

	let filtered = this.itemsToGive.filter(tradeItem => Helpers.itemEquals(item, tradeItem));
	if (filtered.length > 0) {
		this._itemsToGiveRemoving.push(this.itemsToGive.splice(this.itemsToGive.indexOf(filtered[0]), 1)[0]);
	}
};

/**
 * Cancel the trade session. The `end` event will be emitted if this succeeds.
 * @param {function} [callback] - Just gets an error
 */
TradeSession.prototype.cancel = function(callback) {
	this._cmdQueue.push({"command": "cancel", "tryCount": 5}, callback);
};

TradeSession.prototype._getTradeStatus = function() {
	if (this._pollInFlight || this._ended) {
		return;
	}

	this._pollInFlight = true;
	this._clearTradeStatusPoll();
	this._doCommand('tradestatus', {}, 1, (err) => {
		this._pollInFlight = false;
		this._enqueueTradeStatusPoll();

		if (err) {
			this._statusFailures++;
			this._onTradeStatusFailure();
		} else {
			this._statusFailures = 0;
		}
	}, "tradeoffermanager");
};

TradeSession.prototype._onTradeStatusFailure = function() {
	if (!this._ended && ++this._statusFailures >= 5) {
		this._setEnded();
		this.emit('end', ETradeSessionStatus.TimedOut);
	}
};

TradeSession.prototype._clearTradeStatusPoll = function() {
	if (this._tradeStatusPoll) {
		clearTimeout(this._tradeStatusPoll);
		this._tradeStatusPoll = null;
	}
};

TradeSession.prototype._enqueueTradeStatusPoll = function() {
	if (this._ended) {
		return;
	}

	this._clearTradeStatusPoll();
	this._tradeStatusPoll = setTimeout(() => this._getTradeStatus(), this.pollInterval);
};

TradeSession.prototype._handleTradeStatus = function(status) {
	if (this._ended || !status.success) {
		return;
	}

	if (this._pollInFlight) {
		// we got data from a non-poll request, so the poll that's in flight will be stale. just ignore it.
		this._ignoreNextPoll = true;
	}

	if (status.trade_status > ETradeSessionStatus.TurnedIntoTradeOffer) {
		// Unknown trade status
		this._setEnded();
		this.emit('error', new Error("Unknown trade session status: " + status.trade_status));
		return;
	} else if (status.trade_status == ETradeSessionStatus.TurnedIntoTradeOffer) {
		this._setEnded();
		this.emit('end', status.trade_status, status.tradeid);
		return;
	} else if (status.trade_status > ETradeSessionStatus.Active) {
		// the trade is over, yo
		this._setEnded();
		this.emit('end', status.trade_status);
		return;
	}

	if (status.me && status.me.assets) {
		this._usedSlots = Object.keys(status.me.assets).map(key => parseInt(key, 10));
	}

	if (status.me && status.them) {
		if (status.me.assets) {
			this._myItemsInTradeOrder = fixItemArray(status.me.assets);
		}
		if (status.them.assets) {
			this._theirItemsInTradeOrder = fixItemArray(status.them.assets);
		}
	}

	// the trade session is active
	// process events
	if (status.events) {
		let eventKeys = Object.keys(status.events).map(key => parseInt(key, 10));
		eventKeys.forEach((key) => {
			if (key < this._logPos) {
				this.emit('debug', 'Ignoring event ' + key + '; logPos is ' + this._logPos);
				return;
			}

			let event = status.events[key];
			let isUs = event.steamid == this._manager.steamID.getSteamID64();
			this.emit('debug', 'Handling event ' + event.action + ' (' + (ETradeSessionAction[event.action] || event.action) + ')');

			switch (parseInt(event.action, 10)) {
				case ETradeSessionAction.AddItem:
					this.me.ready = false;
					this.them.ready = false;

					if (isUs) {
						this.getInventory(event.appid, event.contextid, (err, inv) => {
							if (err) {
								return this._terminateWithError("Cannot get my inventory: " + err.message);
							}

							let item = inv.filter(item => item.assetid == event.assetid)[0];
							let filtered;
							if (!item) {
								this._terminateWithError(`Could not find item ${event.appid}_${event.contextid}_${event.assetid} in our inventory even though it was added to the trade`);
							} else if ((filtered = this.itemsToGive.filter(tradeItem => Helpers.itemEquals(tradeItem, item))).length > 0) {
								// this item is already in the trade
								filtered[0].pendingAdd = false;
							} else {
								// this item was added to the trade
								this.itemsToGive.push(item);
								this._fixAssetOrder();
							}
						});
					} else {
						this._getTheirInventory(event.appid, event.contextid, (err, inv) => {
							if (err) {
								return this._terminateWithError("Cannot get partner inventory: " + err.message);
							}

							let item = inv.filter(item => item.assetid == event.assetid)[0];
							if (!item) {
								this._terminateWithError(`Could not find item ${event.appid}_${event.contextid}_${event.assetid} in partner's inventory even though it was added to the trade`);
							} else if (this.itemsToReceive.some(tradeItem => Helpers.itemEquals(tradeItem, item))) {
								// item is already in the trade
							} else {
								this.itemsToReceive.push(item);
								this._fixAssetOrder();
								// it's very probable that the user will want to immediately take some action based on this,
								// but steam will reject it if the version we send doesn't match the actual version
								// delay by a tick so the version can update
								process.nextTick(() => {
									this.emit('itemAdded', item);
								});
							}
						});
					}

					break;

				case ETradeSessionAction.RemoveItem:
					this.me.ready = false;
					this.them.ready = false;

					let itemArray = isUs ? this.itemsToGive : this.itemsToReceive;
					for (let i = 0; i < itemArray.length; i++) {
						if (!Helpers.itemEquals(itemArray[i], event)) {
							continue;
						}

						// we found it
						let item = itemArray.splice(i, 1)[0];
						if (!isUs) {
							// it's very probable that the user will want to immediately take some action based on this,
							// but steam will reject it if the version we send doesn't match the actual version
							// delay by a tick so the version can update
							process.nextTick(() => {
								this.emit('itemRemoved', item);
							});
						}
					}

					let filtered;
					if (isUs && (filtered = this._itemsToGiveRemoving.filter(tradeItem => Helpers.itemEquals(event, tradeItem))).length > 0) {
						this._itemsToGiveRemoving.splice(this._itemsToGiveRemoving.indexOf(filtered[0]), 1);
					}

					break;

				case ETradeSessionAction.Ready:
					if (isUs) {
						this.me.ready = true;
					} else {
						this.them.ready = true;
						// it's very probable that the user will want to immediately take some action based on this,
						// but steam will reject it if the version we send doesn't match the actual version
						// delay by a tick so the version can update
						process.nextTick(() => {
							this.emit('ready');
						});
					}

					break;

				case ETradeSessionAction.Unready:
					if (isUs) {
						this.me.ready = false;
					} else {
						this.them.ready = false;
						// it's very probable that the user will want to immediately take some action based on this,
						// but steam will reject it if the version we send doesn't match the actual version
						// delay by a tick so the version can update
						process.nextTick(() => {
							this.emit('unready');
						});
					}

					break;

				case ETradeSessionAction.Confirm:
					if (isUs) {
						this.me.confirmed = true;
					} else {
						this.them.confirmed = true;
						// it's very probable that the user will want to immediately take some action based on this,
						// but steam will reject it if the version we send doesn't match the actual version
						// delay by a tick so the version can update
						process.nextTick(() => {
							this.emit('confirm');
						});
					}

					break;

				case ETradeSessionAction.Chat:
					if (isUs) {
						break; // don't care
					} else {
						this.emit('chat', event.text);
					}

					break;

				default:
					this.emit('debug', 'Unknown event ' + (ETradeSessionAction[event.action] || event.action));
			}

			if (this._logPos <= key) {
				this._logPos = key + 1;
			}
		});
	}

	// all events have been processed. do some sanity checks to make sure we aren't out of sync
	if (status.version && status.version > this._version) {
		this.emit('debug', `Got new version ${status.version} (had ${this._version})`);
		this._version = status.version;
	}

	if (status.me && status.them) {
		['ready', 'confirmed'].forEach((thingToCheck) => {
			for (let i = 0; i < 2; i++) {
				if (this._ended) {
					return;
				}

				let who = i == 0 ? 'me' : 'them';
				let local = this[who][thingToCheck];
				let remote = status[who][thingToCheck];

				if (local != remote) {
					return this._terminateWithError(`Trade got out of sync. Local ${thingToCheck} status for ${who} is ${local} but we got ${remote}`);
				}
			}
		});

		// Assets? Only check if we aren't loading some inventory
		if (!this._loadingInventory()) {
			for (let i = 0; i < 2; i++) {
				if (this._ended) {
					return;
				}

				let who = i == 0 ? 'me' : 'them';
				let remoteAssets = status[who].assets && fixItemArray(status[who].assets);
				let localAssets = (i == 0 ? this.itemsToGive : this.itemsToReceive).filter(item => !item.pendingAdd);

				if (remoteAssets) {
					if (remoteAssets.length != localAssets.length) {
						return this._terminateWithError(`Trade got out of sync. Local asset count for ${who} is ${localAssets.length} but we got ${remoteAssets.length}`);
					}

					// make sure the assets match up
					localAssets.forEach((localAsset) => {
						if (this._ended) {
							return;
						}

						// is this asset in the remote list?
						if (!remoteAssets.some(remoteAsset => Helpers.itemEquals(localAsset, remoteAsset))) {
							return this._terminateWithError(`Trade got out of sync. Couldn't find local asset ${localAsset.appid}_${localAsset.contextid}_${localAsset.assetid || localAsset.id} in remote list`);
						}
					});

					// no need to check the remote list because we've already checked that the list lengths are the same
					// if there was something in remote that we don't have, we'd have noticed since some item that's not in remote
					// would need to be in the local list to make the lengths match
				}
			}
		}
	}

	function fixItemArray(obj) {
		let keys = Object.keys(obj).map(key => parseInt(key, 10));
		keys.sort();
		let vals = [];
		keys.forEach(key => vals.push(obj[key]));
		return vals;
	}
};

TradeSession.prototype._setEnded = function() {
	this._ended = true;
	this._clearTradeStatusPoll();
};

TradeSession.prototype._terminateWithError = function(msg) {
	this._setEnded();
	this.emit('error', new Error(msg));
};

TradeSession.prototype._getTheirInventory = function(appid, contextid, callback) {
	let invKey = `${appid}_${contextid}`;
	if (this._theirInventory[invKey]) {
		callback(null, this._theirInventory[invKey]);
		return;
	}

	if (this._theirInventoryLoading[invKey]) {
		this._theirInventoryLoading[invKey].push(callback);
		return;
	}

	this._theirInventoryLoading[invKey] = [];

	let doAttempt = (attemptNum) => {
		if (attemptNum > 3) {
			let err = new Error(`Cannot get partner inventory for appid ${appid} contextid ${contextid}`);
			callback(err);
			this._theirInventoryLoading[invKey].forEach(cb => cb(err));
			return;
		}

		this.emit('debug', 'Getting their inventory ' + invKey);
		this._manager._community.httpRequestGet(`https://steamcommunity.com/trade/${this.partner.getSteamID64()}/foreigninventory/`, {
			"qs": {
				"sessionid": this._manager._community.getSessionID(),
				"steamid": this.partner.getSteamID64(),
				"appid": appid,
				"contextid": contextid
			},
			"headers": {
				"Referer": `https://steamcommunity.com/trade/${this.partner.getSteamID64()}/foreigninventory/`,
				"X-Requested-With": "XMLHttpRequest"
			},
			"json": true
		}, (err, res, body) => {
			if (err || res.statusCode != 200) {
				this.emit('debug', 'Error getting partner inventory: ' + (err ? err.message : res.statusCode));
				setTimeout(() => doAttempt(attemptNum + 1), 500);
				return;
			}

			if (!body.success || !body.rgInventory || !body.rgDescriptions) {
				this.emit('debug', 'Error getting partner inventory: no success/rgInventory/rgDescriptions');
				setTimeout(() => doAttempt(attemptNum + 1), 500);
				return;
			}

			let inv = [];
			for (let i in body.rgInventory) {
				if (body.rgInventory.hasOwnProperty(i)) {
					inv.push(body.rgInventory[i]);
				}
			}

			// gottem
			let stahp = false;
			inv = inv.map((item) => {
				if (stahp) {
					return null;
				}

				item.appid = appid;
				item.contextid = contextid;
				item.assetid = item.id = item.id || item.assetid;

				let descKey = `${item.classid}_${item.instanceid}`;
				if (!body.rgDescriptions[descKey]) {
					stahp = true;
					this.emit('debug', 'Error getting partner inventory: missing description');
					setTimeout(() => doAttempt(attemptNum + 1), 500);
					return null;
				}

				let desc = body.rgDescriptions[descKey];
				for (let i in desc) {
					if (desc.hasOwnProperty(i)) {
						item[i] = desc[i];
					}
				}

				return new EconItem(item);
			});

			if (stahp) {
				return;
			}

			this._theirInventory[invKey] = inv;
			callback(null, inv);
			this._theirInventoryLoading[invKey].forEach(cb => cb(null, inv));
		}, "tradeoffermanager");
	};

	doAttempt(1);
};

TradeSession.prototype._doCommand = function(command, args, tryCount, callback) {
	args = args || {};
	tryCount = tryCount || 3;

	args.sessionid = this._manager._community.getSessionID();
	args.logpos = this._logPos;
	args.version = this._version;

	if (command == "additem") {
		args.slot = this._getNextSlot();
	}

	let lastError = null;

	let doAttempt = (attemptNum) => {
		if (attemptNum > tryCount) {
			callback && callback(lastError);
			return;
		}

		this._manager._community.httpRequestPost(`https://steamcommunity.com/trade/${this.partner.getSteamID64()}/${command}/`, {
			"form": args,
			"headers": {
				"Referer": `https://steamcommunity.com/trade/${this.partner.getSteamID64()}`,
				"X-Requested-With": "XMLHttpRequest"
			},
			"json": true
		}, (err, res, body) => {
			if (err || res.statusCode != 200) {
				lastError = err ? err : new Error('HTTP error ' + res.statusCode);
				this.emit('debug', 'Cannot do command ' + command + ': ' + (err ? err.message : res.statusCode));
				setTimeout(() => doAttempt(attemptNum + 1), 500);
				return;
			}

			if (!body.success) {
				lastError = new Error('No success in response');
				this.emit('debug', 'Cannot do command ' + command + ': no success');
				setTimeout(() => doAttempt(attemptNum + 1), 500);
				return;
			}

			if (command == 'tradestatus' && this._ignoreNextPoll) {
				this._ignoreNextPoll = false;
			} else {
				this._handleTradeStatus(body);
			}

			callback && callback(null);
		}, "tradeoffermanager");
	};

	doAttempt(1);
};

TradeSession.prototype._getNextSlot = function() {
	for (let i = 0; i < 1000000; i++) {
		if (!this._usedSlots.includes(i)) {
			return i;
		}
	}

	throw new Error('wtf a million items');
};

TradeSession.prototype._loadingInventory = function() {
	for (let i in this._theirInventoryLoading) {
		if (this._theirInventoryLoading.hasOwnProperty(i) && this._theirInventoryLoading[i] && !this._theirInventory[i]) {
			return true;
		}
	}

	for (let i in this._myInventoryLoading) {
		if (this._myInventoryLoading.hasOwnProperty(i) && this._myInventoryLoading[i] && !this._myInventoryLoading[i]) {
			return true;
		}
	}

	return false;
};

TradeSession.prototype._fixAssetOrder = function() {
	let itemsToGive = [];
	let itemsToReceive = [];

	this._myItemsInTradeOrder.forEach((itemToFind) => {
		let item = this.itemsToGive.filter(itemInTrade => Helpers.itemEquals(itemToFind, itemInTrade));
		if (!item[0]) {
			return;
		}

		itemsToGive.push(item[0]);
	});

	this._theirItemsInTradeOrder.forEach((itemToFind) => {
		let item = this.itemsToReceive.filter(itemInTrade => Helpers.itemEquals(itemToFind, itemInTrade));
		if (!item[0]) {
			return;
		}

		itemsToReceive.push(item[0]);
	});

	this.itemsToGive = itemsToGive;
	this.itemsToReceive = itemsToReceive;
};

function shallowClone(obj) {
	let newObj = {};
	for (let i in obj) {
		if (obj.hasOwnProperty(i)) {
			newObj[i] = obj[i];
		}
	}

	return newObj;
}
