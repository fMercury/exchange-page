import RootStore from 'stores/Root';
import { BigNumber } from '../utils/bignumber';
import { ContractType } from './Provider';
import { action, observable } from 'mobx';
import { bnum } from '../utils/helpers';
import PromiEvent from 'promievent';
import { BigNumberCached } from '../services/blockchainReader';
import { Call } from '../services/multicall/MulticallService';
import { getEtherscanLink } from 'utils/etherscan';

export enum EventType {
    Buy = 'Buy',
    Sell = 'Sell',
}

export interface BuyEvent {
    price: BigNumber;
    amount: BigNumber;
    totalPaid: BigNumber;
    blockNumber: number;
    blockTime: string;
    type: EventType;
    hash: string;
}

export interface SellEvent {
    price: BigNumber;
    amount: BigNumber;
    totalReceived: BigNumber;
    blockNumber: number;
    blockTime: string;
    type: EventType;
    hash: string;
}

export enum DatState {
    STATE_INIT,
    STATE_RUN,
    STATE_CLOSE,
    STATE_CANCEL,
}

interface DatStateCached {
    value: DatState;
    blockNumber: number;
}

interface DatInfo {
    minInvestment?: BigNumber;
    currentPrice?: BigNumberCached;
    initReserve?: BigNumberCached;
    initGoal?: BigNumberCached;
    reserveBalance?: BigNumberCached;
    buySlopeNum?: BigNumberCached;
    buySlopeDen?: BigNumberCached;
    state?: DatStateCached;
}

interface DatInfoMap {
    [index: string]: DatInfo;
}

export interface BuyReturnCached {
    value: BuyReturn;
    blockNumber: number;
}

export interface SellReturnCached {
    value: SellReturn;
    blockNumber: number;
}

export interface BuyReturn {
    tokensIssued: BigNumber;
    totalPaid: BigNumber;
    pricePerToken: BigNumber;
}

export interface SellReturn {
    tokensSold: BigNumber;
    currencyReturned: BigNumber;
    returnPerToken: BigNumber;
}

export type TradeEvent = BuyEvent | SellEvent;

export default class DatStore {
    @observable datParams: DatInfoMap;
    rootStore: RootStore;

    constructor(rootStore) {
        this.rootStore = rootStore;
        this.datParams = {} as DatInfoMap;
    }

    private getDatContract(datAddress: string) {
        const { providerStore } = this.rootStore;
        return providerStore.getContract(
            providerStore.getActiveWeb3React(),
            ContractType.DecentralizedAutonomousTrust,
            datAddress
        );
    }

    areAllStaticParamsLoaded(datAddress: string): boolean {
        return (
            !!this.getMinInvestment(datAddress) &&
            !!this.getBuySlopeNum(datAddress) &&
            !!this.getBuySlopeDen(datAddress) &&
            !!this.getInitGoal(datAddress) &&
            !!this.getInitReserve(datAddress)
        );
    }

    isInitPhase(datAddress: string) {
        return this.getState(datAddress) == DatState.STATE_INIT;
    }
    isRunPhase(datAddress: string) {
        return this.getState(datAddress) == DatState.STATE_RUN;
    }
    isCancelled(datAddress: string) {
        return this.getState(datAddress) == DatState.STATE_CANCEL;
    }
    isClosed(datAddress: string) {
        return this.getState(datAddress) == DatState.STATE_CLOSE;
    }

    getState(datAddress: string): DatState | undefined {
        const value = this.rootStore.blockchainStore.getCachedValue({
            contractType: ContractType.DecentralizedAutonomousTrust,
            address: datAddress,
            method: 'state',
        });
        return value ? (bnum(value).toNumber() as DatState) : undefined;
    }

    getMinInvestment(datAddress: string): BigNumber | undefined {
        const value = this.rootStore.blockchainStore.getCachedValue({
            contractType: ContractType.DecentralizedAutonomousTrust,
            address: datAddress,
            method: 'minInvestment',
        });
        return value ? bnum(value) : undefined;
    }

    getBuySlopeNum(datAddress: string) {
        const value = this.rootStore.blockchainStore.getCachedValue({
            contractType: ContractType.DecentralizedAutonomousTrust,
            address: datAddress,
            method: 'buySlopeNum',
        });
        return value ? bnum(value) : undefined;
    }

    getBuySlopeDen(datAddress: string) {
        const value = this.rootStore.blockchainStore.getCachedValue({
            contractType: ContractType.DecentralizedAutonomousTrust,
            address: datAddress,
            method: 'buySlopeDen',
        });
        return value ? bnum(value) : undefined;
    }

    getInitGoal(datAddress: string) {
        const value = this.rootStore.blockchainStore.getCachedValue({
            contractType: ContractType.DecentralizedAutonomousTrust,
            address: datAddress,
            method: 'initGoal',
        });
        return value ? bnum(value) : undefined;
    }

    getReserveBalance(datAddress: string): BigNumber | undefined {
        const value = this.rootStore.blockchainStore.getCachedValue({
            contractType: ContractType.DecentralizedAutonomousTrust,
            address: datAddress,
            method: 'buybackReserve',
        });
        return value ? bnum(value) : undefined;
    }

    getInitReserve(datAddress: string) {
        const value = this.rootStore.blockchainStore.getCachedValue({
            contractType: ContractType.DecentralizedAutonomousTrust,
            address: datAddress,
            method: 'initReserve',
        });
        return value ? bnum(value) : undefined;
    }

    genStaticParamCalls(datAddress: string): Call[] {
        const baseCall = {
            contractType: ContractType.DecentralizedAutonomousTrust,
            address: datAddress,
        };

        const calls: Call[] = [
            {
                ...baseCall,
                method: 'initReserve',
            },
            {
                ...baseCall,
                method: 'initGoal',
            },
            {
                ...baseCall,
                method: 'buySlopeNum',
            },
            {
                ...baseCall,
                method: 'buySlopeDen',
            },
        ];

        return calls;
    }

    async estimateBuyValue(
        datAddress: string,
        currencyValue: BigNumber
    ): Promise<BigNumber> {
        const dat = this.getDatContract(datAddress);
        return bnum(
            await dat.methods.estimateBuyValue(currencyValue.toString()).call()
        );
    }

    async estimateSellValue(
        datAddress: string,
        quantityToSell: BigNumber
    ): Promise<BigNumber> {
        const dat = this.getDatContract(datAddress);
        return bnum(
            await dat.methods
                .estimateSellValue(quantityToSell.toString())
                .call()
        );
    }

    async fetchBuyEvents(
        datAddress: string,
        numToGet: number
    ): Promise<TradeEvent[]> {
        const dat = this.getDatContract(datAddress);

        let buyEvents = await dat.getPastEvents('Buy', {
            fromBlock: 0,
            toBlock: 'latest',
        });

        buyEvents.reverse();
        buyEvents = buyEvents.slice(0, numToGet);

        return Promise.all(
            buyEvents.map((buyEvent) => {
                if (this.isBuyEventValid(buyEvent)) {
                    return this.parseBuyEvent(buyEvent);
                }
            })
        );
    }

    async fetchSellEvents(
        datAddress: string,
        numToGet: number
    ): Promise<TradeEvent[]> {
        const dat = this.getDatContract(datAddress);

        let sellEvents = await dat.getPastEvents('Sell', {
            fromBlock: 0,
            toBlock: 'latest',
        });

        sellEvents.reverse();
        sellEvents = sellEvents.slice(0, numToGet);

        return Promise.all(
            sellEvents.map((sellEvent) => {
                if (this.isSellEventValid(sellEvent)) {
                    return this.parseSellEvent(sellEvent);
                }
            })
        );
    }

    async parseBuyEvent(buyEvent) {
        const amount = bnum(buyEvent.returnValues._fairValue);
        const totalPrice = bnum(buyEvent.returnValues._currencyValue);

        const blockTime = await this.rootStore.providerStore.getBlockTime(
            buyEvent.blockNumber
        );

        const chainId = this.rootStore.providerStore.getActiveWeb3React().chainId;

      const event: BuyEvent = {
            price: totalPrice.div(amount),
            amount: amount,
            totalPaid: totalPrice,
            blockNumber: buyEvent.blockNumber,
            blockTime: blockTime,
            type: EventType.Buy,
            hash: getEtherscanLink(chainId, buyEvent.transactionHash, 'transaction' ),
        };

        return event;
    }

    // format sell event
    async parseSellEvent(sellEvent) {
        const amount = bnum(sellEvent.returnValues._fairValue);
        const totalReceived = bnum(sellEvent.returnValues._currencyValue);

        const blockTime = await this.rootStore.providerStore.getBlockTime(
            sellEvent.blockNumber
        );
        
        const chainId = this.rootStore.providerStore.getActiveWeb3React().chainId;

        const event: SellEvent = {
            price: totalReceived.div(amount),
            amount: amount,
            totalReceived: totalReceived,
            blockNumber: sellEvent.blockNumber,
            blockTime: blockTime,
            type: EventType.Sell,
            hash: getEtherscanLink(chainId, sellEvent.transactionHash, 'transaction' ),
        };

        return event;
    }

    isBuyEventValid(buyEvent) {
        return (
            !!buyEvent.returnValues &&
            buyEvent.returnValues._fairValue &&
            !!buyEvent.returnValues._currencyValue
        );
    }

    isSellEventValid(sellEvent) {
        return (
            !!sellEvent.returnValues &&
            sellEvent.returnValues._fairValue &&
            !!sellEvent.returnValues._currencyValue
        );
    }

    async fetchBuyReturn(
        datAddress: string,
        totalPaid: BigNumber
    ): Promise<BuyReturnCached> {
        const blockNumber = this.rootStore.providerStore.getCurrentBlockNumber();

        const tokensIssued = await this.estimateBuyValue(datAddress, totalPaid);
        const pricePerToken = totalPaid.div(tokensIssued);

        return {
            value: {
                totalPaid,
                tokensIssued,
                pricePerToken,
            },
            blockNumber,
        };
    }

    async fetchSellReturn(
        datAddress: string,
        tokensSold: BigNumber
    ): Promise<SellReturnCached> {
        const blockNumber = this.rootStore.providerStore.getCurrentBlockNumber();

        const currencyReturned = await this.estimateSellValue(
            datAddress,
            tokensSold
        );

        const returnPerToken = currencyReturned.div(tokensSold);

        return {
            value: {
                tokensSold,
                currencyReturned,
                returnPerToken,
            },
            blockNumber,
        };
    }

    async fetchSpotPrice(datAddress: string): Promise<BigNumber> {
        const minInvestment = this.getMinInvestment(datAddress);
        const spotTokens = await this.estimateBuyValue(
            datAddress,
            minInvestment
        );
        const price = minInvestment.div(spotTokens);
        return price;
    }

    // getRecentTrades(numberOfTrades)
    async fetchRecentTrades(
        datAddress: string,
        numToGet: number
    ): Promise<TradeEvent[]> {
        const buyEvents = await this.fetchBuyEvents(datAddress, numToGet);
        const sellEvents = await this.fetchSellEvents(datAddress, numToGet);

        let combinedTrades: any[] = buyEvents.concat(sellEvents);
        combinedTrades = combinedTrades.sort(function (a, b) {
            return b.blockNumber - a.blockNumber;
        });

        return combinedTrades.slice(0, numToGet);
    }

    // TODO: Return status on failure
    @action buy(
        datAddress: string,
        to: string,
        currencyValue: BigNumber,
        minTokensBought: BigNumber
    ): PromiEvent<any> {
        const { providerStore } = this.rootStore;

        return providerStore.sendTransaction(
            providerStore.getActiveWeb3React(),
            ContractType.DecentralizedAutonomousTrust,
            datAddress,
            'buy',
            [to, currencyValue.toString(), minTokensBought.toString()],
            { value: currencyValue.toString() }
        );
    }

    //TODO: Return status on failure
    @action sell(
        datAddress: string,
        to: string,
        quantityToSell: BigNumber,
        minCurrencyReturned: BigNumber
    ) {
        const { providerStore } = this.rootStore;

        return providerStore.sendTransaction(
            providerStore.getActiveWeb3React(),
            ContractType.DecentralizedAutonomousTrust,
            datAddress,
            'sell',
            [to, quantityToSell.toString(), minCurrencyReturned.toString()]
        );
    }
}
