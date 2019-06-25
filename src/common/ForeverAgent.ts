var util = require('util'),
  Agent = require('http').Agent,
  net = require('net'),
  tls = require('tls'),
  AgentSSL = require('https').Agent;

function getConnectionName(host: any, port: number) {
  var name = '';
  if (typeof host === 'string') {
    name = host + ':' + port;
  } else {
    // For node.js v012.0 and iojs-v1.5.1, host is an object. And any existing localAddress is part of the connection name.
    name = host.host + ':' + host.port + ':' + (host.localAddress ? host.localAddress + ':' : '');
  }
  return name;
}

function createConnectionSSL(port: any, host: any, options: any) {
  if (typeof port === 'object') {
    options = port;
  } else if (typeof host === 'object') {
    options = host;
  } else if (typeof options === 'object') {
    options = options;
  } else {
    options = {};
  }

  if (typeof port === 'number') {
    options.port = port;
  }

  if (typeof host === 'string') {
    options.host = host;
  }

  return tls.connect(options);
}

export class ForeverAgent extends Agent {
  static defaultMinSockets = 5;
  options: any;
  requests: any = {};
  sockets: any = {};
  freeSockets: any = {};
  maxSockets: number;
  minSockets: number;
  constructor(options: any) {
    super();
    var self = this;
    self.options = options || {};
    self.requests = {};
    self.sockets = {};
    self.freeSockets = {};
    self.maxSockets = self.options.maxSockets || Agent.defaultMaxSockets;
    self.minSockets = self.options.minSockets || ForeverAgent.defaultMinSockets;
    self.on('free', function(socket: any, host: any, port: any) {
      var name = getConnectionName(host, port);
      if (self.requests[name] && self.requests[name].length) {
        self.requests[name].shift().onSocket(socket);
      } else if (self.sockets[name].length < self.minSockets) {
        if (!self.freeSockets[name]) self.freeSockets[name] = [];
        self.freeSockets[name].push(socket);

        // if an error happens while we don't use the socket anyway, meh, throw the socket away
        var onIdleError = function() {
          socket.destroy();
        };
        socket._onIdleError = onIdleError;
        socket.on('error', onIdleError);
      } else {
        // If there are no pending requests just destroy the
        // socket and it will get removed from the pool. This
        // gets us out of timeout issues and allows us to
        // default to Connection:keep-alive.
        socket.destroy();
      }
    });
  }

  createConnection = net.createConnection;
  addRequestNoreuse = Agent.prototype.addRequest;

  addRequest(req: any, host: any, port: any) {
    var name = getConnectionName(host, port);

    if (typeof host !== 'string') {
      var options = host;
      port = options.port;
      host = options.host;
    }

    if (
      this.freeSockets[name] &&
      this.freeSockets[name].length > 0 &&
      !req.useChunkedEncodingByDefault
    ) {
      var idleSocket = this.freeSockets[name].pop();
      idleSocket.removeListener('error', idleSocket._onIdleError);
      delete idleSocket._onIdleError;
      req._reusedSocket = true;
      req.onSocket(idleSocket);
    } else {
      this.addRequestNoreuse(req, host, port);
    }
  }

  removeSocket(s: any, name: any, host: any, port: any) {
    if (this.sockets[name]) {
      var index = this.sockets[name].indexOf(s);
      if (index !== -1) {
        this.sockets[name].splice(index, 1);
      }
    } else if (this.sockets[name] && this.sockets[name].length === 0) {
      // don't leak
      delete this.sockets[name];
      delete this.requests[name];
    }

    if (this.freeSockets[name]) {
      var index = this.freeSockets[name].indexOf(s);
      if (index !== -1) {
        this.freeSockets[name].splice(index, 1);
        if (this.freeSockets[name].length === 0) {
          delete this.freeSockets[name];
        }
      }
    }

    if (this.requests[name] && this.requests[name].length) {
      // If we have pending requests and a socket gets closed a new one
      // needs to be created to take over in the pool for the one that closed.
      this.createSocket(name, host, port).emit('free');
    }
  }
}

class ForeverAgentSSL extends ForeverAgent {
  constructor(options: any) {
    super(options);
  }

  createConnection = createConnectionSSL;
  addRequestNoreuse = AgentSSL.prototype.addRequest;
}

ForeverAgent.SSL = ForeverAgentSSL;
