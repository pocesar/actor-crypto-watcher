import * as Apify from 'apify';
import * as vm from 'vm';
import * as moment from 'moment';

const { log } = Apify.utils;

export type AddressType = 'BTC' | 'ETH' | 'NONE';

export interface Transaction {
    tx: string;
    block: string;
    date: string;
    from: Array<string | { value: number, address: string }>;
    to: Array<string | { value: number, address: string }>;
    amount: string;
    fee: string;
}

export interface Output extends Omit<Transaction, 'to' | 'from' | 'date'> {
    type: AddressType;
    address: string;
    balance: string;
    from: string;
    to: string;
    tag: string | null;
    date: string | null;
    count: string | null;
    scrapedAt: string;
}

export interface Info {
    balance: string;
    tag: string | null;
    count: string | null;
    transaction: Transaction | null;
}

export const XPATHS = {
    ETH: {
        BALANCE: '//div[@id="ContentPlaceHolder1_divSummary"]//div[contains(@class, "row")][contains(., "Balance:")]/div[2]',
        TAG: '//div[@id="ContentPlaceHolder1_divSummary"]//div[contains(@class, "card-header")]//span[contains(@class, "u-label--secondary")]',
        COUNT: '//div[@id="transactions"]//a[starts-with(@href, "/txs?a")]',
        LAST_PAGE: '//a[@class="page-link" and contains(., "Last")]',
        NO_ENTRIES: '//div[text()="There are no matching entries"]',
    },
};

export interface Schema {
    addresses: string[];
    proxy?: any;
    minDate?: string;
    maxDate?: string;
    maxTransactions?: number;
    webhook?: string;
    customData?: Record<string, any>;
}

/**
 * Clean non number information from input
 */
export const cleanFloat = (number: number | string) => {
    return `${number}`.replace(/[^\d.]+/g, '');
};

export const detectType = (address: string): AddressType => {
    if (address?.startsWith('0x')) {
        return 'ETH';
    }

    if (address?.match(/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/)) {
        return 'BTC';
    }

    return 'NONE';
};

type PARAMS<T, CUSTOMDATA = any> = T & {
    Apify: typeof Apify;
    customData: CUSTOMDATA;
    request: Apify.Request;
};

/**
 * Compile a IO function for mapping, filtering and outputing items.
 * Can be used as a no-op for interaction-only (void) functions on `output`.
 * Data can be mapped and filtered twice.
 *
 * Provided base map and filter functions is for preparing the object for the
 * actual extend function, it will receive both objects, `data` as the "raw" one
 * and "item" as the processed one.
 *
 * Always return a passthrough function if no outputFunction provided on the
 * selected key.
 */
export const extendFunction = async <RAW, INPUT extends Record<string, any>, MAPPED, HELPERS extends Record<string, any>>({
    key,
    output,
    filter,
    map,
    input,
    helpers,
}: {
    key: string,
    map?: (data: RAW, params: PARAMS<HELPERS>) => Promise<MAPPED | MAPPED[]>,
    output?: (data: MAPPED, params: PARAMS<HELPERS>) => Promise<void>,
    filter?: (obj: { data: RAW, item: MAPPED }, params: PARAMS<HELPERS>) => Promise<boolean>,
    input: INPUT,
    helpers: HELPERS,
}) => {
    const base = {
        ...helpers,
        Apify,
        customData: input.customData || {},
    } as PARAMS<HELPERS>;

    const evaledFn = (() => {
        // need to keep the same signature for no-op
        if (typeof input[key] !== 'string' || input[key].trim() === '') {
            return new vm.Script('({ item }) => item');
        }

        try {
            return new vm.Script(input[key], {
                lineOffset: 0,
                produceCachedData: false,
                displayErrors: true,
                filename: `${key}.js`,
            });
        } catch (e) {
            throw new Error(`"${key}" parameter must be a function`);
        }
    })();

    /**
     * Returning arrays from wrapper function split them accordingly.
     * Normalize to an array output, even for 1 item.
     */
    const splitMap = async (value: any, args: any) => {
        const mapped = map ? await map(value, args) : value;

        if (!Array.isArray(mapped)) {
            return [mapped];
        }

        return mapped;
    };

    return async <T extends Record<string, any>>(data: RAW, args: T) => {
        const merged = { ...base, ...args };

        for (const item of await splitMap(data, merged)) {
            if (filter && !(await filter({ data, item }, merged))) {
                continue; // eslint-disable-line no-continue
            }

            const result = await (evaledFn.runInThisContext()({
                ...merged,
                data,
                item,
            }));

            for (const out of (Array.isArray(result) ? result : [result])) {
                if (output) {
                    if (out !== null) {
                        await output(out, merged);
                    }
                    // skip output
                }
            }
        }
    };
};

/**
 * Do a generic check when using Apify Proxy
 */
export const proxyConfiguration = async ({
    proxyConfig,
    required = true,
    force = Apify.isAtHome(),
    blacklist = ['GOOGLESERP'],
    hint = [],
}: {
    proxyConfig: any,
    required?: boolean,
    force?: boolean,
    blacklist?: string[],
    hint?: string[],
}) => {
    const configuration = await Apify.createProxyConfiguration(proxyConfig);

    // this works for custom proxyUrls
    if (required) {
        if (!configuration || (!configuration.usesApifyProxy && !configuration.proxyUrls?.length) || !configuration.newUrl()) {
            throw new Error(`\n=======\nYou're required to provide a valid proxy configuration\n\n=======`);
        }
    }

    // check when running on the platform by default
    if (force) {
        // only when actually using Apify proxy it needs to be checked for the groups
        if (configuration?.usesApifyProxy) {
            if (blacklist.some((blacklisted) => configuration.groups?.includes(blacklisted))) {
                throw new Error(`\n=======\nThese proxy groups cannot be used in this actor. Choose other group or contact support@apify.com to give you proxy trial:\n\n*  ${blacklist.join('\n*  ')}\n\n=======`);
            }

            // specific non-automatic proxy groups like RESIDENTIAL, not an error, just a hint
            if (hint.length && !hint.some((group) => configuration.groups?.includes(group))) {
                Apify.utils.log.info(`\n=======\nYou can pick specific proxy groups for better experience:\n\n*  ${hint.join('\n*  ')}\n\n=======`);
            }
        }
    }

    return configuration as Apify.ProxyConfiguration | undefined;
};

export const fixDate = (date: string | number) => {
    if (!date) {
        return null;
    }
    
    const matches = `${date}`.match(/(\d{1,2}):(\d{1,2}):(\d{1,2})/);

    if (!matches) {
        if (+date) {
            return new Date(+date * 1000).toISOString();
        }
        
        return null;
    }

    const [matched, hour, minute, second] = matches;

    return `${date}`.replace(matched, `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`);
};

export interface MinMax {
    min?: number | string;
    max?: number | string;
}

const parseTimeUnit = (value: any) => {
    if (!value) {
        return null;
    }

    if (value === 'today' || value === 'yesterday') {
        return (value === 'today' ? moment() : moment().subtract(1, 'day')).startOf('day');
    }

    const [, number, unit] = `${value}`.match(/^(\d+) (minute|second|day|hour|month|year|week)s?$/i) || [];

    if (+number && unit) {
        return moment().subtract(+number, unit as any);
    }

    return moment(value);
};

/**
 * Generate a function that can check date intervals depending on the input
 */
export const minMaxDates = ({ min, max }: MinMax) => {
    const minDate = parseTimeUnit(min);
    const maxDate = parseTimeUnit(max);

    if (minDate && maxDate && maxDate.diff(minDate) < 0) {
        throw new Error(`Minimum date ${minDate.toString()} needs to be less than max date ${maxDate.toString()}`);
    }

    return {
        /**
         * cloned min date, if set
         */
        get minDate() {
            return minDate?.clone();
        },
        /**
         * cloned max date, if set
         */
        get maxDate() {
            return maxDate?.clone();
        },
        /**
         * compare the given date/timestamp to the time interval
         */
        compare(time: string | number) {
            const base = moment(time);
            return (minDate ? minDate.diff(base) <= 0 : true) && (maxDate ? maxDate.diff(base) >= 0 : true);
        },
    };
};

/**
 * Get transaction list
 */
export const createTxAddPage = (requestQueue: Apify.RequestQueue) => async (request: Apify.Request, newBase?: any, pageNumber?: number) => {
    const { address, label, base, page } = request.userData;
    pageNumber = pageNumber || ((page || 0) + 1);

    return requestQueue.addRequest({
        url: label === 'BTC'
            ? `https://www.blockchain.com/btc/address/${address}?page=${pageNumber}`
            : `https://etherscan.io/txs?a=${address}&p=${pageNumber}`,
        userData: {
            label,
            address,
            base: newBase || base,
            main: false,
            page: pageNumber,
        },
    });
};

/**
 * Get wallet balances
 */
export const createAddWallet = (requestQueue: Apify.RequestQueue) => async (address: string) => {
    const label = detectType(address);

    if (label === 'NONE') {
        log.warning(`Address is invalid: ${address}`);
        return;
    }

    return requestQueue.addRequest({
        url: label === 'BTC'
            ? `https://www.blockchain.com/btc/address/${address}`
            : `https://etherscan.io/address/${address}`,
        userData: {
            label,
            address,
        },
    });
};
