let Sha = require('jssha');

var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
var ALPHABET_MAP = {};
for (var i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP[ ALPHABET.charAt(i) ] = i;
}
let BASE = 58;

function toHexString(byteArray) {
    return Array.from(byteArray, function (byte) {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('')
}

function sha256(string) {
    const shaObj = new Sha('SHA-256', 'HEX');
    shaObj.update(string);
    return shaObj.getHash('HEX');
}

function decode58(string) {
    if (string.length === 0) return []

    var i, j, bytes = [ 0 ]
    for (i = 0; i < string.length; i++) {
        var c = string[ i ]
        if (!(c in ALPHABET_MAP)) throw new Error('Non-base58 character')

        for (j = 0; j < bytes.length; j++) bytes[ j ] *= BASE
        bytes[ 0 ] += ALPHABET_MAP[ c ]

        var carry = 0
        for (j = 0; j < bytes.length; ++j) {
            bytes[ j ] += carry

            carry = bytes[ j ] >> 8
            bytes[ j ] &= 0xff
        }

        while (carry) {
            bytes.push(carry & 0xff)

            carry >>= 8
        }
    }

    // deal with leading zeros
    for (i = 0; string[ i ] === '1' && i < string.length - 1; i++) bytes.push(0)

    return bytes.reverse()
}

function base58ToHex(pub) {
    let decodeCheck = decode58(pub);
    if (decodeCheck.length <= 4) {
        console.error("ERROR CHECK");
        return null;
    }

    let decodeData = decodeCheck.slice(0, decodeCheck.length - 4);
    return toHexString(decodeData);
}

function hexToBase58(string) {
    const primary = sha256(string);
    const secondary = sha256(primary);

    const buffer = Buffer.from(string + secondary.slice(0, 8), 'hex');
    const digits = [ 0 ];

    for (let i = 0; i < buffer.length; i++) {
        for (let j = 0; j < digits.length; j++)
            digits[ j ] <<= 8;

        digits[ 0 ] += buffer[ i ];

        let carry = 0;

        for (let j = 0; j < digits.length; ++j) {
            digits[ j ] += carry;
            carry = (digits[ j ] / 58) | 0;
            digits[ j ] %= 58;
        }

        while (carry) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }

    for (let i = 0; buffer[ i ] === 0 && i < buffer.length - 1; i++)
        digits.push(0);

    return digits.reverse().map(digit => ALPHABET[ digit ]).join('');
}

module.exports = {
    base58ToHex,
    hexToBase58
};