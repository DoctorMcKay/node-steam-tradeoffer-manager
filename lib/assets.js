var TradeOfferManager = require('./index.js');
var Async = require('async');
var EconItem = require('./classes/EconItem.js');

const ITEMS_PER_CLASSINFO_REQUEST = 100;

TradeOfferManager.prototype._digestDescriptions = function(descriptions) {
	var cache = this._assetCache;

	if (!this._language) {
		return;
	}

	if (descriptions && !(descriptions instanceof Array)) {
		descriptions = Object.keys(descriptions).map(function(key) {
			return descriptions[key];
		});
	}

	(descriptions || []).forEach(function(item) {
		if (!item || !item.appid || !item.classid) {
			return;
		}

		cache[item.appid + '_' + item.classid + '_' + (item.instanceid || '0')] = item;
	});
};

TradeOfferManager.prototype._mapItemsToDescriptions = function(appid, contextid, items) {
	var cache = this._assetCache;

	if (!(items instanceof Array)) {
		items = Object.keys(items).map(function(key) {
			return items[key];
		});
	}

	return items.map(function(item) {
		item.appid = appid || item.appid;
		item.contextid = contextid || item.contextid;

		var key = item.appid + '_' + item.classid + '_' + (item.instanceid || '0');
		if (!cache[key]) {
			// This item isn't in our description cache
			return new EconItem(item);
		}

		for (var i in cache[key]) {
			if (cache[key].hasOwnProperty(i)) {
				item[i] = cache[key][i];
			}
		}

		return new EconItem(item);
	});
};

TradeOfferManager.prototype._hasDescription = function(item, appid) {
	appid = appid || item.appid;
	return !!this._assetCache[appid + '_' + item.classid + '_' + (item.instanceid || '0')];
};

TradeOfferManager.prototype._addDescriptions = function(items, callback) {
	var self = this;

	var descriptionRequired = items.filter(function(item) {
		return !self._hasDescription(item);
	});

	if (descriptionRequired.length == 0) {
		callback(null, self._mapItemsToDescriptions(null, null, items));
		return;
	}

	self._requestDescriptions(descriptionRequired, function(err) {
		if (err) {
			callback(err);
		} else {
			callback(null, self._mapItemsToDescriptions(null, null, items));
		}
	});
};

TradeOfferManager.prototype._requestDescriptions = function(classes, callback) {
	var apps = [];
	var appids = [];

	// Split this out into appids
	classes.forEach(function(item) {
		var index = appids.indexOf(item.appid);
		if (index == -1) {
			index = appids.push(item.appid) - 1;
			var arr = [];
			arr.appid = item.appid;
			apps.push(arr);
		}

		// Don't add a class/instanceid pair that we already have in the list
		if (apps[index].indexOf(item.classid + '_' + (item.instanceid || '0')) == -1) {
			apps[index].push(item.classid + '_' + (item.instanceid || '0'));
		}
	});

	Async.map(apps, function(app, cb) {
		var chunks = [];
		var items = [];

		// Split this into chunks of ITEMS_PER_CLASSINFO_REQUEST items
		while (app.length > 0) {
			chunks.push(app.splice(0, ITEMS_PER_CLASSINFO_REQUEST));
		}

		Async.each(chunks, function(chunk, chunkCb) {
			var input = {
				"appid": app.appid,
				"language": this._language,
				"class_count": chunk.length
			};

			chunk.forEach(function(item, index) {
				var parts = item.split('_');
				input['classid' + index] = parts[0];
				input['instanceid' + index] = parts[1];
			});

			this.emit('debug', "Requesting classinfo for " + chunk.length + " items");
			this._apiCall('GET', {
				"iface": "ISteamEconomy",
				"method": "GetAssetClassInfo"
			}, 1, input, function(err, body) {
				if (err) {
					chunkCb(err);
					return;
				}

				if (!body.result || !body.result.success) {
					chunkCb(new Error("Invalid API response"));
					return;
				}

				var chunkItems = Object.keys(body.result).map(function(id) {
					if (!id.match(/^\d+(_\d+)?$/)) {
						return null;
					}

					var item = body.result[id];
					item.appid = app.appid;
					return item;
				}).filter(function(item) {
					return !!item;
				});

				items = items.concat(chunkItems);

				chunkCb(null);
			});
		}.bind(this), function(err) {
			if (err) {
				cb(err);
			} else {
				cb(null, items);
			}
		});
	}.bind(this), function(err, result) {
		if (err) {
			callback(err);
			return;
		}

		result.forEach(this._digestDescriptions.bind(this));
		callback();
	}.bind(this));
};
