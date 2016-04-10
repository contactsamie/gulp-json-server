'use strict';

var _ = require('lodash');
var jsonServer = require('json-server');
var utils = require('gulp-util');
var fs = require('fs');
var through = require('through2');
var bodyParser = require('body-parser');

var GulpJsonServer = function(options){
	this.server = null;
	this.instance = null;
	this.router = null;
	this.serverStarted = false;
	this.pipedKickStart = false;

	this.options = {
		data: 'db.json',
		port: 3000,
		rewriteRules: null,
		customRoutes: null,
		baseUrl: null,
		id: 'id',
		deferredStart: false,
		static: null
	};
	_.assign(this.options, options || {});

	
	var start = function (options) {
		if(this.serverStarted){
			utils.log('JSON server already started');
			return this.instance;
		}

        var server = jsonServer.create();
        
		server.use(bodyParser.json());
		server.use(bodyParser.urlencoded({ extended: true }));

		if(this.options.rewriteRules){
			server.use(jsonServer.rewriter(this.options.rewriteRules));
		}

		if (this.options.static) {
			server.use(jsonServer.defaults({static: this.options.static}));
		} else {
			server.use(jsonServer.defaults());
		}

		if(this.options.customRoutes){
			for(var path in this.options.customRoutes) {
				var customRoute = this.options.customRoutes[path];
				server[customRoute.method.toLocaleLowerCase()](path, customRoute.handler);
			}
		}

		var router = jsonServer.router(this.options.data);
		if(this.options.baseUrl) {
			server.use(this.options.baseUrl, router);
		}
		else{
			server.use(router);
		}

		if(this.options.id){
			router.db._.id = this.options.id;
		}

		this.server = server;
		this.router = router;
		this.instance = server.listen(this.options.port);
		this.serverStarted = true;

		return this.instance;
	};

	var ensureServerStarted = function(){
		if(this.instance === null){
			throw 'JSON server not started';
		}
	}.bind(this);
	
	var reload = function(data){
		var newDb = null;

		if(typeof data === 'undefined'){
			utils.log('nothing to reload, quit', utils.colors.green(data));
		}
		
		if(typeof data === 'string'){
			// attempt to reload file
			utils.log('reload from file', utils.colors.yellow(data));
			newDb = JSON.parse(fs.readFileSync(data));
		}
		else{
			// passed new DB object, store it
			utils.log('reload from object');
			newDb = data;
		}

		if(newDb === null){
			throw 'No valid data passed for reloading. You should pass either data file path or new DB in-memory object';
		}

		this.router.db.object = newDb;
		utils.log(utils.colors.magenta('server reloaded'));
	}.bind(this);
	
	this.kill = function(){
		ensureServerStarted();
		this.instance.close();
	};
	
	
	// ==== new impl ====
	
	this.pipe = function(options){
		var resolvedOptions = resolveOptions(options);
		var aggregatorObject = this.serverStarted && resolvedOptions.includePreviousDbState ? this.router.db.object : {};
		
		var gulpJsonSrvInstance = this;
		
		return through.obj(function (file, enc, cb) {
			if (file.isNull()) {
				cb(null, file);
				return;
			}

			if (file.isStream()) {
				cb(new utils.PluginError('gulp-json-srv', 'Streaming not supported'));
				return;
			}

			try {
				var appendedObject = JSON.parse(file.contents.toString());
				if(resolvedOptions.debug){
					utils.log('reload with data', appendedObject);
				}
				_.assign(aggregatorObject, appendedObject || {});
				
				if(!gulpJsonSrvInstance.serverStarted){
					start(resolvedOptions);
				}
				
				reload(aggregatorObject);

				this.push(file);
			} catch (err) {
				this.emit('error', new utils.PluginError('gulp-json-srv', err));
			}

			cb();
		});
	};
	
	
	
	// ==== legacy impl ====
	if(legacyMode){
		var resolvedImmediateOptions = resolveOptions(immediateOptions);
		
		var logDeprecationMessage = function(funcName){
			utils.log(utils.colors.yellow('The function "' + funcName + '" is deprecated since release of v0.0.8. Consider using pipeline intergation with pipe() function.'));
		};
		
		this.start = function(){
			logDeprecationMessage('start()');
			start(resolvedImmediateOptions);
		};
		
		this.reload = function(data){
			logDeprecationMessage('reload()');
			ensureServerStarted();

			var isDataFile = typeof resolvedImmediateOptions.data === 'string';
			var noData = typeof(data) === 'undefined';
				
			if(noData){
				if(!isDataFile){
					// serving in-memory DB, exit without changes
					return;
				}
				
				reload(resolvedImmediateOptions.data);
			}
			else{
				reload(data);
			}
		};
		
		// maintain legacy behavior
		if(!resolvedImmediateOptions.deferredStart){
			start(resolvedImmediateOptions);
		}
	}
};





module.exports = {
	create: function(){
		// create server, not start immediately 
		return new GulpJsonServer();	
	},
	start: function(options){
		// legacy implementation - create server and start immediately with specified options
		return new GulpJsonServer(options);
	}
};
