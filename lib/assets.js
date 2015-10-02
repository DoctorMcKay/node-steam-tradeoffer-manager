var TradeOfferManager = require('./index.js');
var Async = require('async');
var EconItem = require('./classes/EconItem.js');

TradeOfferManager.prototype._digestDescriptions = function(descriptions) {
	var cache = this._assetCache;
	
	if(!this._language) {
		return;
	}
	
	if(descriptions && !(descriptions instanceof Array)) {
		descriptions = Object.keys(descriptions).map(function(key) {
			return descriptions[key];
		});
	}
	
	(descriptions || []).forEach(function(item) {
		if(!item || !item.appid || !item.classid) {
			return;
		}
		
		cache[item.appid + '_' + item.classid + '_' + (item.instanceid || '0')] = item;
	});
};

TradeOfferManager.prototype._mapItemsToDescriptions = function(appid, contextid, items) {
	var cache = this._assetCache;
	
	if(!(items instanceof Array)) {
		items = Object.keys(items).map(function(key) {
			return items[key];
		});
	}
	
	return items.map(function(item) {
		item.appid = appid || item.appid;
		item.contextid = contextid || item.contextid;
		
		var key = item.appid + '_' + item.classid + '_' + (item.instanceid || '0');
		if(!cache[key]) {
			// This item isn't in our description cache
			return new EconItem(item);
		}

		for(i in cache[key]) {
			item[i] = cache[key][i];
		}
		
		return new EconItem(item);
	});
};

TradeOfferManager.prototype._hasDescription = function(item, appid) {
	appid = appid || item.appid;
	return !!this._assetCache[appid + '_' + item.classid + '_' + (item.instanceid || '0')];
};

TradeOfferManager.prototype._requestDescriptions = function(classes, callback) {
	var apps = [];
	var appids = [];
	
	classes.forEach(function(item) {
		var index = appids.indexOf(item.appid);
		if(index == -1) {
			index = appids.push(item.appid) - 1;
			var arr = [];
			arr.appid = item.appid;
			apps.push(arr);
		}
		
		// Don't add a class/instanceid pair that we already have in the list
		if(apps[index].indexOf(item.classid + '_' + (item.instanceid || '0')) == -1) {
			apps[index].push(item.classid + '_' + (item.instanceid || '0'));
		}
	});
	
	Async.map(apps, function(app, cb) {
		var input = {
			"appid": app.appid,
			"language": this._language,
			"class_count": app.length
		};
		
		app.forEach(function(item, index) {
			var parts = item.split('_');
			input['classid' + index] = parts[0];
			input['instanceid' + index] = parts[1];
		});
		
		this._apiCall('GET', {"iface": "ISteamEconomy", "method": "GetAssetClassInfo"}, 1, input, function(err, body) {
			if(err) {
				cb(err);
				return;
			}
			
			if(!body.result || !body.result.success) {
				cb(new Error("Invalid API response"));
				return;
			}
			
			var items = Object.keys(body.result).map(function(id) {
				if(!id.match(/^\d+(_\d+)?$/)) {
					return null;
				}
				
				var item = body.result[id];
				item.appid = app.appid;
				return item;
			}).filter(function(item) {
				return !!item;
			});
			
			cb(null, items);
		});
	}.bind(this), function(err, result) {
		if(err) {
			callback(err);
			return;
		}
		
		result.forEach(this._digestDescriptions.bind(this));
		callback();
	}.bind(this));
};
