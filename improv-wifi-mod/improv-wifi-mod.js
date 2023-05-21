import BLEServer from "bleserver";
import { uuid } from "btutils";
import GAP from 'gap';
import BLEExports from './consts';
const StateCodes = BLEExports.StateCodes;
const ErrorCodes = BLEExports.ErrorCodes;
const Commands = BLEExports.Commands;

export default class ImprovWifi extends BLEServer {
    deviceName;
    ssid;
    state;
    error;
    stateCharacteristic;
    errorCharacteristic;
    rpcCharacteristic;
    onCredentialsRecieved;
    notify;
    constructor({ deviceName, onCredentialsRecieved }) {
        super();
        this.deviceName = deviceName;
        this.state = StateCodes.STATE_AUTHORIZED;
        this.error = ErrorCodes.ERROR_NONE;
        this.securityParameters = { mitm:true };
        this.onCredentialsRecieved = onCredentialsRecieved;
    }
    startImprov() {
        trace("Starting Improv\n");
        let advertisingData = {
            flags: GAP.ADFlag.LE_GENERAL_DISCOVERABLE_MODE,
            completeUUID128List: [uuid `00467768-6228-2272-4663-277478268000`],
            solicitationUUID128List: [uuid `00467768-6228-2272-4663-277478268000`],
            serviceDataUUID128: uuid `00467768-6228-2272-4663-277478268000`,
            connectionInterval: [0x20, 0x30],
            completeName: this.deviceName,
            shortName: this.deviceName,
            appearance: 0x00,
            uri: "https://junipertechnology.co",
            publicAddress: "00:11:22:33:AA:BB",
            txPowerLevel: 0x00,
            randomAddress: "00:11:22:33:AA:BB",
            manufacturerSpecific: {
                identifier: 0xFFFF,
                data: [0x77, 0x68, 0x62, 0x28, 0x22, 0x72, 0x46, 0x63, 0x27, 0x74, 0x78, 0x26, 0x80, 0x00]
            }
        };

        this.startAdvertising(
            {
                advertisingData,
                scanResponseData: advertisingData
            }
        );
    }
    onDisconnected() {
        trace("Disconnected\n");
        this.state = StateCodes.STATE_AUTHORIZED;
        this.error = ErrorCodes.ERROR_NONE;
        this.errorCharacteristic = null;
        this.stateCharacteristic = null;
        this.startImprov();
    }
    onReady() {
        trace("Ready\n");
        this.startImprov();
    }
    onCharacteristicRead(characteristic) {
        trace(`Read: ${JSON.stringify(characteristic)}\n`);
        if (characteristic.name === "STATE") {
            this.notifyState()
        }
        if (characteristic.name === "ERROR") {
            this.notifyError()
        }
    }
    onConnected() {
        trace("Connected\n");
        this.state = StateCodes.STATE_AUTHORIZED;
        this.error = ErrorCodes.ERROR_NONE;
    }
    onCharacteristicNotifyDisabled(characteristic) {
        trace('onCharacteristicNotifyDisabled\n');
        trace('characteristic', characteristic);
        switch (characteristic.name) {
            case 'STATE':
                this.stateCharacteristic = null;
                break;
            case 'ERROR':
                this.errorCharacteristic = null;
                break;
            case 'RPC_RESULT':
                this.rpcCharacteristic = null;
                break;
            case 'CAPABILITIES':
                break;
            default:
                this.error = ErrorCodes.ERROR_UNKNOWN;
                this.notifyError();
                break;
        }
    }
    onCharacteristicNotifyEnabled(characteristic) {
        trace('onCharacteristicNotifyEnabled\n');
        this.notify = characteristic;
        switch (characteristic.name) {
            case 'STATE':
                this.stateCharacteristic = characteristic;
                this.notifyState();
                break;
            case 'ERROR':
                this.errorCharacteristic = characteristic;
                this.notifyValue(this.notify, this.error);
                break;
            case 'RPC_COMMAND':
                break;
            case 'RPC_RESULT':
                this.rpcCharacteristic = characteristic;
                break;
            case 'CAPABILITIES':
                this.notifyValue(this.notify, 0x01);
                break;
            default:
                this.error = ErrorCodes.ERROR_UNKNOWN;
                this.notifyError();
                break;
        }
    }
    onCharacteristicWritten(characteristic, value) {
        // 010a07446f70706c6572096d6f666f7332303130
        trace(`Written: ${characteristic.name}, in state ${characteristic.state}, with value ${value}, value[0] is ${value?.[0]}, which is a type ${typeof value?.[0]} \n`);
        // this is where we go and update state again if necessary
        switch (characteristic.name) {
            case "RPC_COMMAND":
                this.ssid = value;
                if (value[0] === Commands.WIFI_SETTINGS) {
                    trace("Handling wifi settings\n");
                    this.state = StateCodes.STATE_PROVISIONING;
                    this.notifyState();
                    this.handleInboundWifiSettings(value);
                }
                else {
                    this.error = ErrorCodes.ERROR_UNKNOWN_RPC;
                    this.notifyError();
                }
                break;
            default:
                this.error = ErrorCodes.ERROR_UNKNOWN;
                this.notifyState();
                break;
        }
    }
    handleInboundWifiSettings(data) {
        trace("Handling inbound wifi settings\n");
        const ssid_length = data[2];
        const ssid_start = 3;
        const ssid_end = ssid_start + ssid_length;
        const pass_length = data[ssid_end];
        const pass_start = ssid_end + 1;
        const pass_end = pass_start + pass_length;
        const ssid = this.buildValue(data, ssid_start, ssid_end);
        const password = this.buildValue(data, pass_start, pass_end);
        let result = this.onCredentialsRecieved({ ssid, password });
        if (!result) {
            this.state = StateCodes.STATE_AUTHORIZED;
            this.notifyState();
        }
        else {
            this.state = StateCodes.STATE_PROVISIONED;
            this.notifyState();
        }
    }
    buildValue(data, start, end) {
        trace(`Building value from ${start} to ${end}\n`);
        let str = '';
        for (var i = start; i < end; i++) {
            str += String.fromCharCode(data[i]);
        }
        return str;
    }
    notifyState() {
        trace(`Notifying state: ${this.state}\n`);
        if (!this.stateCharacteristic)
            return;
        this.notifyValue(this.stateCharacteristic, this.state);
    }
    notifyError() {
        trace(`Notifying error: ${this.error}\n`);
        if (!this.errorCharacteristic)
            return;
        this.notifyValue(this.errorCharacteristic, this.error);
    }
    couldNotConnect() {
        trace("Could not connect\n");
        this.error = ErrorCodes.ERROR_UNABLE_TO_CONNECT;
        this.notifyError();
    }
}
