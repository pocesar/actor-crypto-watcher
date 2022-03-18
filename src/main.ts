import * as Apify from 'apify';
import * as _ from 'lodash';
import * as moment from 'moment';
import {
    detectType,
    Schema,
    Output,
    cleanFloat,
    Transaction,
    Info,
    proxyConfiguration,
    extendFunction,
    XPATHS,
    minMaxDates,
    createTxAddPage,
    createAddWallet,
    fixDate,
} from './functions';

const { log } = Apify.utils;

Apify.main(async () => {
    const input: Schema = (await Apify.getInput()) as any;

    if (!input || !input?.addresses?.length) {
        throw new Error('Missing "addresses" array parameter');
    }

    const {
        maxTransactions = 10,
    } = input;

    const requests = input.addresses.map<Apify.RequestOptions | undefined>((address) => {
        const label = detectType(address);

        if (label === 'NONE') {
            log.warning(`Address is invalid: ${address}`);
            return;
        }

        return {
            url: label === 'BTC'
                ? `https://www.blockchain.com/btc/address/${address}`
                : `https://etherscan.io/address/${address}`,
            userData: {
                label,
                address,
            },
        };
    }).filter(s => s) as Apify.RequestOptions[];

    const requestQueue = await Apify.openRequestQueue();

    const addWallet = createAddWallet(requestQueue);
    const addTxPage = createTxAddPage(requestQueue);

    const addresses = new Map<string, number>((await Apify.getValue('ADDRESSES') as any[]) || []);
    const txs = new Set((await Apify.getValue('TXS') as any[]) || []);

    const persistState = async () => {
        await Apify.setValue('ADDRESSES', [...addresses]);
        await Apify.setValue('txs', [...txs]);
    };

    Apify.events.on('migrating', persistState);

    for (const request of requests) {
        await requestQueue.addRequest(request);
    }

    const checkDate = minMaxDates({
        min: input.minDate,
        max: input.maxDate,
    });

    const extendOutputFunction = await extendFunction<Info, Schema, Output, any>({
        map: async (data, { request }) => {
            const { address, label } = request.userData;
            const { transaction } = data;

            const base = {
                type: label,
                address,
                tag: data.tag ?? null,
                balance: cleanFloat(data.balance),
                count: data.count ?? null,
                scrapedAt: new Date().toISOString(),
            } as Output;

            return {
                ...base,
                amount: transaction ? cleanFloat(transaction.amount) : null,
                from: transaction
                    ? (data.tag === transaction.from[0] ? [address] : transaction.from)
                    : [],
                to: transaction
                    ? data.tag === transaction.to[0] ? [address] : transaction.to
                    : [],
                block: transaction?.block ?? null,
                tx: transaction?.tx ?? null,
                date: transaction ? fixDate(transaction.date) : null,
                fee: transaction ? cleanFloat(transaction.fee) : null,
            };
        },
        filter: async ({ item }) => {
            return (maxTransactions ? (addresses.get(item.address) || 0) < maxTransactions : true)
                && (item.date ? checkDate.compare(item.date) : true)
                && !txs.has(`${item.tx}${item.to}${item.from}${item.amount}`);
        },
        output: async (item) => {
            addresses.set(item.address, (addresses.get(item.address) || 0) + 1);
            txs.add(`${item.tx}${item.to}${item.from}`);
            await Apify.pushData(item);
        },
        key: 'extendOutputFunction',
        input,
        helpers: {
            _,
            moment,
            XPATHS,
            checkDate,
        },
    });

    const proxyConfig = await proxyConfiguration({
        proxyConfig: input.proxy,
    });

    const extendScraperFunction = await extendFunction({
        output: async () => { }, // eslint-disable-line
        key: 'extendScraperFunction',
        input,
        helpers: {
            _,
            moment,
            requestQueue,
            detectType,
            extendOutputFunction,
            XPATHS,
            checkDate,
            addTxPage,
            addWallet,
        },
    });

    await extendScraperFunction(undefined, {
        label: 'SETUP',
    });

    const crawler = new Apify.PuppeteerCrawler({
        proxyConfiguration: proxyConfig,
        requestQueue,
        useSessionPool: true,
        maxConcurrency: 10,
        maxRequestRetries: 3,
        preNavigationHooks: [async ({ page }, gotoOptions) => {
            await Apify.utils.puppeteer.blockRequests(page);

            gotoOptions.timeout = 30000;
            gotoOptions.waitUntil = 'domcontentloaded';
        }],
        handlePageFunction: async ({ page, request }) => {
            const { address, label, base } = request.userData;
            let hasNextPage = true;

            log.info(`Scraping ${label} address ${address}${
                request.userData.page ? `, transaction page ${request.userData.page}` : ' balances'
            }`);

            if (label === 'ETH') {
                if ((await page.$x(XPATHS.ETH.NO_ENTRIES)).length) {
                    log.warning(`No transactions on ${address}`);
                    await extendOutputFunction({
                        balance: '0',
                        count: '0',
                        tag: null,
                        transaction: null,
                    }, {
                        page,
                        request,
                    });
                    return;
                }

                const [balance, tag, count] = await Promise.all([
                    page.$x(XPATHS.ETH.BALANCE),
                    page.$x(XPATHS.ETH.TAG),
                    page.$x(XPATHS.ETH.COUNT),
                ]);

                if (!base) {
                    const txCount = (await count?.[0].evaluate((s) => s.innerText.trim())) || null;

                    await addTxPage(request, {
                        balance: (await balance?.[0].evaluate((s) => s.innerText.trim())) || null,
                        tag: (await tag?.[0].evaluate((s) => s.innerText.trim())) || null,
                        count: txCount,
                    }, 1);
                } else {
                    await page.waitForSelector('#paywall_mask table tbody tr');

                    const transactions = await page.evaluate((): Transaction[] => {
                        const trs = [...document.querySelectorAll<HTMLTableRowElement>('#paywall_mask table tbody tr')];
                        const text = (tds: NodeListOf<HTMLTableCellElement>) => (
                            index: number,
                            getter: (td: HTMLTableCellElement) => any = (td) => td.innerText.trim(),
                        ) => getter(tds?.[index]) || null;
                        const parseTag = (selector: string) => (td: HTMLTableCellElement) => {
                            const split = (
                                td.querySelector<HTMLSpanElement>(selector)?.dataset?.originalTitle
                                ?? td.querySelector<HTMLSpanElement>(selector)?.title
                                ?? ''
                            ).split(/(\(|\))/);

                            if (split.length === 1) {
                                return split[0].trim();
                            }

                            return split[2].trim();
                        };
                        const parseFrom = parseTag('a[data-original-title],span.text-truncate');
                        const parseTo = parseTag('span > span');

                        return trs.map((tr) => {
                            const tds = text(tr.querySelectorAll('td').filter((el) => (el?.style.display !== 'none')));

                            return {
                                tx: tds(1),
                                method: tds(2, (td) => td.querySelector('span')?.dataset?.originalTitle ?? null),
                                block: tds(3),
                                date: tds(4, (td) => td.querySelector('span')?.dataset?.originalTitle ?? null),
                                from: [tds(5, parseFrom)],
                                to: [tds(7, parseTo)],
                                amount: tds(8),
                                fee: tds(9),
                            };
                        });
                    });

                    const [lastPage] = await page.$x(XPATHS.ETH.LAST_PAGE);

                    if (lastPage) {
                        hasNextPage = await lastPage.evaluate((el) => (+(new URL(el?.href)?.searchParams?.get('p')) ?? 0))
                            < (request.userData.page || 0) + 1;
                    }

                    for (const transaction of transactions) {
                        await extendOutputFunction({
                            ...base,
                            transaction,
                        }, {
                            page,
                            request,
                        });
                    }

                    await extendScraperFunction(transactions, {
                        request,
                        page,
                        label: 'TRANSACTIONS',
                    });
                }
            } else if (label === 'BTC') {
                await page.waitForSelector('#__NEXT_DATA__');

                const json = _.get(await page.$eval('#__NEXT_DATA__', (s) => JSON.parse(s.innerHTML)), 'props.initialProps.pageProps');

                if (!base) {
                    await addTxPage(request, {
                        balance: json.addressBalance.confirmed,
                        tag: null,
                        count: json.addressBalance.txs,
                    }, 1);
                } else {
                    hasNextPage = (json?.addressTransactions?.length ?? 0) === (json?.pageSize ?? Infinity);

                    for (const tx of json.addressTransactions) {
                        await extendOutputFunction({
                            ...base,
                            transaction: {
                                date: `${tx.time}`,
                                fee: tx.fee,
                                method: 'Transfer',
                                block: tx.block.height,
                                amount: tx.inputs.reduce((out: number, { value }: any) => {
                                    return out + value;
                                }, 0),
                                tx: tx.txid,
                                from: tx.inputs.map((i: any) => ({ address: i.address, value: i.value })),
                                to: tx.outputs.map((i: any) => ({ address: i.address, value: i.value })),
                            },
                        }, {
                            page,
                            request,
                        });
                    }

                    await extendScraperFunction(json.addressTransactions, {
                        request,
                        page,
                        label: 'TRANSACTIONS',
                    });
                }
            }

            if (base && hasNextPage) {
                if ((addresses.get(address) || 0) < maxTransactions) {
                    await addTxPage(request);
                }
            }

            await extendScraperFunction(undefined, {
                request,
                page,
                label: 'HANDLE',
            });
        },
        handleFailedRequestFunction: async ({ request }) => {
            const { address, label } = request.userData;

            log.warning(`${label} address ${address} failed ${request.retryCount} times`);
        },
    });

    await crawler.run();

    if (input.webhook) {
        await Apify.addWebhook({
            eventTypes: ['ACTOR.RUN.SUCCEEDED'],
            requestUrl: input.webhook,
            idempotencyKey: Apify.getEnv().actorRunId!,
            payloadTemplate: `{
                "userId": {{userId}},
                "customData": ${JSON.stringify(input.customData)},
                "createdAt": {{createdAt}},
                "eventType": {{eventType}},
                "eventData": {{eventData}},
                "resource": {{resource}}
            }`,
        });
    }

    await extendScraperFunction(undefined, {
        label: 'FINISH',
    });

    log.info('Done');
});
