"use strict";

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
		descriptions = Object.keys(descriptions).map(key => descriptions[key]);
	}

	(descriptions || []).forEach((item) => {
		if (!item || !item.appid || !item.classid) {
			return;
		}

		cache[`${item.appid}_${item.classid}_${item.instanceid || '0'}`] = item;
	});
};

TradeOfferManager.prototype._mapItemsToDescriptions = function(appid, contextid, items) {
	var cache = this._assetCache;

	if (!(items instanceof Array)) {
		items = Object.keys(items).map(key => items[key]);
	}

	return items.map((item) => {
		item.appid = appid || item.appid;
		item.contextid = contextid || item.contextid;

		var key = `${item.appid}_${item.classid}_${item.instanceid || '0'}`;
		if (!cache[key]) {
			// This item isn't in our description cache
			return new EconItem(item);
		}

		for (let i in cache[key]) {
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
	var descriptionRequired = items.filter(item => !this._hasDescription(item));

	if (descriptionRequired.length == 0) {
		callback(null, this._mapItemsToDescriptions(null, null, items));
		return;
	}

	this._requestDescriptions(descriptionRequired, (err) => {
		if (err) {
			callback(err);
		} else {
			callback(null, this._mapItemsToDescriptions(null, null, items));
		}
	});
};

TradeOfferManager.prototype._requestDescriptions = function(classes, callback) {
	var apps = [];
	var appids = [];

	// Split this out into appids
	classes.forEach((item) => {
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

	Async.map(apps, (app, cb) => {
		var chunks = [];
		var items = [];

		// Split this into chunks of ITEMS_PER_CLASSINFO_REQUEST items
		while (app.length > 0) {
			chunks.push(app.splice(0, ITEMS_PER_CLASSINFO_REQUEST));
		}

		Async.each(chunks, (chunk, chunkCb) => {
			var input = {
				"appid": app.appid,
				"language": this._language,
				"class_count": chunk.length
			};

			chunk.forEach((item, index) => {
				var parts = item.split('_');
				input['classid' + index] = parts[0];
				input['instanceid' + index] = parts[1];
			});

			this.emit('debug', "Requesting classinfo for " + chunk.length + " items");
			this._apiCall('GET', {
				"iface": "ISteamEconomy",
				"method": "GetAssetClassInfo"
			}, 1, input, (err, body) => {
				if (err) {
					chunkCb(err);
					return;
				}

				if (!body.result || !body.result.success) {
					chunkCb(new Error("Invalid API response"));
					return;
				}

				var chunkItems = Object.keys(body.result).map((id) => {
					if (!id.match(/^\d+(_\d+)?$/)) {
						return null;
					}

					var item = body.result[id];
					item.appid = app.appid;
					return item;
				}).filter(item => !!item);

				items = items.concat(chunkItems);

				chunkCb(null);
			});
		}, (err) => {
			if (err) {
				cb(err);
			} else {
				cb(null, items);
			}
		});
	}, (err, result) => {
		if (err) {
			callback(err);
			return;
		}

		result.forEach(this._digestDescriptions.bind(this));
		callback();
	});
};
