const chrome = require('chrome-aws-lambda');
const { login } = require('ing-au-login');
const axios = require('axios');
const moment = require('moment');
const parse = require('csv-parse');

exports.sync = async event => {
  const response = { success: null, inserts: null, error: null };

  try {
    const browser = await chrome.puppeteer.launch({
      args: chrome.args,
      executablePath: await chrome.executablePath,
      slowMo: 50,
      //headless: false // testing only
    });

    const page = await browser.newPage();
    const token = await login(page, process.env.CLIENT_NUMBER, process.env.ACCESS_CODE);

    await browser.close();

    const csv = await axios.post(
      'https://www.ing.com.au/api/ExportTransactions/Service/ExportTransactionsService.svc/json/' +
        'ExportTransactions/ExportTransactions',
      'X-AuthToken=' + encodeURIComponent(token) + '&AccountNumber=&Format=csv&FilterStartDate=' +
        moment().subtract(process.env.SEARCH_DAYS, 'days').format('YYYY-MM-DDTHH:mm:ssZZ') +
        '&FilterEndDate=&FilterMinValue=&FilterMaxValue=&FilterProductTransactionTypeId=' +
        '&SearchQuery=&ReturnPersonalTransactions=true&ReturnBusinessTransactions=false&IsSpecific='
    ).then(response => response.data);

    const parser = parse(csv, { from_line: 2 });

    const transactions = [];

    // 'account': 'asset_id'
    const accounts = {};

    for (const [variable, value] of Object.entries(process.env)) {
      const account = variable.match(/^ACCOUNT_([0-9]+)$/);

      if (account) {
        accounts[account[1]] = value;
      }
    }

    for await (const transaction of parser) {
      let [date, account, payee, credit, amount] = transaction;

      // exclude transfers between our own accounts
      if (payee.includes('Internal Transfer')) {
        continue;
      }

      // we're only interested in money being spent, so exclude any deposits
      if (!/^[-0-9.]+$/.test(amount)) {
        continue;
      }

      // change date into international format
      date = date.split('/').reverse().join('-');

      // start from 2022 financial year
      if (moment(date).isBefore('2021-07-01')) {
          continue;
      }

      // match ing account number to lunch money asset id
      let asset_id = accounts[account] || null;

      // don't include transactions that don't have a matching lunch money asset
      if (!asset_id) {
          continue;
      }

      // split out receipt number
      let receipt = payee.match(/Receipt ([0-9]+)/);

      // exclude transactions that don't have a receipt number
      if (!receipt) {
        continue;
      }

      // use receipt number for external id de-duping
      let external_id = receipt[1];

      let tags = [];

      // split out card number
      let card = payee.match(/Card [0-9x]{12}([0-9]{4})/);

      // use last 4 card digits as a tag
      if (card) {
          tags.push('card-' + card[1]);
      }

      // strip everything after the receipt number,
      // except for direct debits, as they have a description after the receipt number
      if (!payee.includes('Direct Debit')) {
        payee = payee.slice(0, payee.indexOf(receipt[0]));
      }

      // remove unnecessary strings
      [
        'Visa Purchase',
        'EFTPOS Purchase',
        'Direct Debit',
        receipt[0]
      ].forEach(s => payee = payee.replace(s, ''));

      // remove unnecessary whitespace and dashes
      payee = payee.replace(/[- ]+/g, ' ').trim();

      transactions.push({
        date,
        amount,
        payee,
        asset_id,
        external_id,
        tags
      });
    }

    const insert = await axios.post(
        'https://dev.lunchmoney.app/v1/transactions',
        {
          transactions,
          debit_as_negative: true,
          skip_balance_update: true
        },
        {
          headers: {
            Authorization: 'Bearer ' + process.env.API_KEY
          }
        }
    ).then(response => response.data);

    if (insert.error) {
      throw new Error(insert.error);
    }

    response.success = true;
    response.inserts = insert.ids.length;
  } catch (e) {
    response.success = false;
    response.error = e.message;
  }

  return response;
}
