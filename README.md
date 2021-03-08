# Bitcoin / Ethereum address watcher
​
Watch for balance and transactions for Bitcoin and Ethereum addresses.
​
- [Features](#features)
- [Output](#output)
- [Advanced usage](#advanced-usage)
- [License](#license)
​
## Features
​
* Filter by date of transactions
* Watch Ethereum (0x addresses) and Bitcoin addresses (1, 3 and bech addresses)
* Execute webhooks when done
​
## Output

BTC:

```json
{
  "type": "BTC",
  "address": "1CounterpartyXXXXXXXXXXXXXXXUWLpVr",
  "tag": null,
  "balance": "213093144295",
  "count": 2811,
  "scrapedAt": "2021-03-08T05:20:33.876Z",
  "amount": "4376",
  "from": [
    {
      "address": "bc1qp4gqa0pmh9646jcfyfx3zm5056rtc0p6jpuys2",
      "value": 547
    },
    {
      "address": "bc1qmx9sytlvxd56h3u9jkquhr3w8yxxnqej6hyyap",
      "value": 547
    },
    {
      "address": "bc1qmx9sytlvxd56h3u9jkquhr3w8yxxnqej6hyyap",
      "value": 547
    },
    {
      "address": "bc1qp4gqa0pmh9646jcfyfx3zm5056rtc0p6jpuys2",
      "value": 547
    },
    {
      "address": "bc1qu3wag4aswmdnxu28y97jn5342usq5y6fw0ur7l",
      "value": 547
    },
    {
      "address": "bc1qmx9sytlvxd56h3u9jkquhr3w8yxxnqej6hyyap",
      "value": 547
    },
    {
      "address": "bc1qp4gqa0pmh9646jcfyfx3zm5056rtc0p6jpuys2",
      "value": 547
    },
    {
      "address": "bc1q3h4wgkddrrr6rn9j7lm2ph69pg6xaxf2ve6d7t",
      "value": 547
    }
  ],
  "to": [
    {
      "address": "1CounterpartyXXXXXXXXXXXXXXXUWLpVr",
      "value": 3787
    }
  ],
  "block": 664103,
  "tx": "999f65a99aed2e10c586b6b24305fd55914d3cf1f9b70f57ab6eb3086f60ff00",
  "date": "2021-01-01T06:34:16.000Z",
  "fee": "589"
}
```

ETH:

```json
{
  "type": "ETH",
  "address": "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe",
  "tag": "EthDev",
  "balance": "458340.509778549895480972",
  "count": "743",
  "scrapedAt": "2021-03-08T05:18:39.317Z",
  "amount": "0.00075936",
  "from": [
    "0xd8215a28bbe8937dd37f4dd1d554944256febdfa"
  ],
  "to": [
    "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe"
  ],
  "block": "11761363",
  "tx": "0xcfc0bc2f636f93b93fed948fe9b25e69aa1144a6b520f8996155296e23e313db",
  "date": "2021-01-31 03:40:21",
  "fee": "0.00314776"
}
```

N.B.: all numbers are strings since Javascript can change the floats and create imprecise results.

## Advanced usage

* Follow transactions using "Extend Scraper Function"

```js
async ({ request, data, label, addWallet }) => {
    if (label === 'TRANSACTIONS' && data) {
        for (const transaction of data) {
            for (const toAddress of transation.to) {
                const address = toAddress.address || toAddress;
                if (address !== data.address) {
                    await addWallet(address);
                }
            }
        }
    }
}
```

## License
​
Apache-2.0
