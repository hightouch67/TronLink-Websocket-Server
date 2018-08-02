const axios = require('axios');
const fs = require('fs');
const WebSocket = require('ws');
const utils = require('./utils.js');

const CMC_API_TRX_ID = 1958; //https://api.coinmarketcap.com/v2/listings/
const CMC_API_URL = `https://api.coinmarketcap.com/v2/ticker/${CMC_API_TRX_ID}/?convert=USD`;

const SETTINGS = require('./settings.json');
const REQUEST_HEADERS = { headers: { 'Content-Type': 'text/plain' } };

module.exports = class {
    constructor(config) {
        console.log(`Starting websocket server on port ${SETTINGS.WEBSOCKET_PORT}`);
        this.lastPrice = null;
        this.connectedClients = [];

        this.wss = new WebSocket.Server({ port: SETTINGS.WEBSOCKET_PORT });
        this.wss.on('connection', this.onConnection.bind(this));
        this.alertMap = {};
        this.lastBlock = -1;

        this.loadStore();
        this.updatePrice(true);
        this.updateBlocks();
    }

    loadStore() {
        try {
            this.store = JSON.parse(fs.readFileSync(SETTINGS.STORE_FILE));
        } catch (e) {
            this.store = {
                block: -1
            }
        }
    }

    saveStore() {
        fs.writeFileSync(SETTINGS.STORE_FILE, JSON.stringify(this.store));
    }

    onConnection(ws) {
        console.log('client connected');
        this.sendPrice(ws);
        this.connectedClients.push(ws);
        ws.on('message', this.onMessage.bind({ _this: this, ws: ws }));
    }

    onMessage(event) {
        console.log(event);
        try {
            let json = JSON.parse(event);
            console.log(json.cmd);
            if (json && json.cmd === 'START_ALERT') {
                let userid = json.userid;
                let address = json.address;

                if (this._this.alertMap[ address ] === undefined)
                    this._this.alertMap[ address ] = {};
                this._this.alertMap[ address ][ userid ] = this.ws;
                console.log(`starting alert for userid ${userid} for address ${address}`);
            }
        } catch (e) {
            console.log(e);
        }
    }

    sendPrice(ws) {
        ws.send(this.lastPrice);
    }

    broadcastAddressAlerts(addressList) {
        for (let i = 0; i < addressList.length; i++) {
            this.broadcastAddressAlert(addressList[ i ]);
        }
    }

    broadcastAddressAlert(address) {
        if (this.alertMap[ address ]) {
            for (let p in this.alertMap[ address ]) {
                if (this.alertMap[ address ].hasOwnProperty(p)) {
                    let ws = this.alertMap[ address ][ p ];
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            cmd: "ADDRESS_EVENT",
                            address: address
                        }));
                    } else {
                        delete this.alertMap[ address ][ p ];
                    }
                }
            }
        }
    }

    broadcastPrice() {
        console.log(`broadcasting price to ${this.connectedClients.length} clients`);
        for (let i = this.connectedClients.length - 1; i >= 0; i--) {
            let ws = this.connectedClients[ i ];
            if (ws.readyState === WebSocket.OPEN) {
                this.sendPrice(ws);
            } else {
                this.connectedClients.splice(i, 1);
            }
        }
    }

    async updatePrice() {
        console.log("fetching price");
        let price = await axios.get(CMC_API_URL).then(x => x.data);

        if (price && price.data && price.data.name === 'TRON' && price.data.last_updated > 0) {
            this.lastPrice = JSON.stringify({
                symbol: price.data.symbol,
                USD: price.data.quotes.USD
            });
            this.broadcastPrice();
        }

        setTimeout(() => {
            this.updatePrice()
        }, SETTINGS.PRICE_UPDATING_INTERVAL);
    }

    _getRequestUrl(path) {
        return SETTINGS.NODE_URL + path;
    }

    async _getNowBlock() {
        return axios.post(this._getRequestUrl('/walletsolidity/getnowblock'), '', REQUEST_HEADERS).then(x => x.data);
    }

    async _getBlock(id) {
        return axios.post(this._getRequestUrl('/walletsolidity/getblockbynum'), JSON.stringify({ num: id }), REQUEST_HEADERS).then(x => x.data);
    }

    async processBlock(block) {
        let hashmap = {};
        if (block && block.transactions) {
            block.transactions.forEach((t) => {
                t.raw_data.contract.forEach((c) => {
                    let from = c.parameter.value.owner_address;
                    let to = c.parameter.value.to_address;
                    hashmap[ utils.hexToBase58(from) ] = 1;
                    if (to)
                        hashmap[ utils.hexToBase58(to) ] = 1;
                });
            });
        }
        let addresses = Object.keys(hashmap);
        if(addresses.length > 0){
            console.log(`found ${addresses.length} address activities in block ${this.store.block + 1}`);
            this.broadcastAddressAlerts(addresses);
        }
    }

    async updateBlocks() {
        try {
            console.log("updating block:" + this.store.block);
            let block = await this._getBlock(this.store.block + 1);
            if (block.block_header) {
                this.processBlock(block);
                this.store.block += 1;
                this.saveStore();
                this.updateBlocks();
            } else {
                setTimeout(this.updateBlocks.bind(this), 1000);
            }
        } catch (e) {
            console.log(e);
            setTimeout(this.updateBlocks.bind(this), 1000);
        }
    }

};