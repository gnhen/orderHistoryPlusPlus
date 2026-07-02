// ==UserScript==
// @name         Micro Center — Real Stock Count
// @namespace    https://granthendricks.com/
// @version      1.0
// @description  Replace the masked "25+ NEW IN STOCK" on Micro Center product pages with the real per-store on-hand count.
// @author       grant
// @match        https://www.microcenter.com/product/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      cart.microcenter.com
// ==/UserScript==

/*
 * How it works
 * ------------
 * Micro Center only ever shows an EXACT stock number on the product page when
 * that store has fewer than 25 units; at 25+ it masks the number as "25+".
 * For items you can actually buy online, the cart un-masks it: every cart line
 * renders  var cartItems = [{... "QuantityInStock": <real count> ...}]  and
 * that field is the true on-hand quantity, uncapped and independent of how many
 * you add or any per-household limit.
 *
 * So when the page says "25+" this script:
 *   1. checks your cart (cart.microcenter.com) to see if the item is already there;
 *      if so it just reads QuantityInStock and touches nothing.
 *   2. otherwise adds one unit, re-reads the cart for QuantityInStock, then
 *      removes exactly that line again so your cart is left as it was.
 *
 * Items that cannot be sold online (the add form posts cartType=list, e.g. some
 * trading-card product) can't be put in the cart, so when they show "25+" the
 * real number simply isn't exposed by the site — those are relabelled ">=25".
 *
 * The cart lives on a different subdomain, so the cross-origin reads/writes go
 * through GM_xmlhttpRequest (hence @connect cart.microcenter.com). Adding to the
 * cart is same-origin, so a normal fetch() (which carries your cookies and a
 * same-origin Referer, both of which the endpoint requires) is enough.
 */

(function () {
  'use strict';

  const CART = 'https://cart.microcenter.com';

  // ---- DOM: the visible "25+ NEW IN STOCK" counters --------------------------

  // Each match: {node} is the text node holding the number, {num} its digits,
  // {capped} whether it ended in '+', {orig} the original text for restore.
  function counters() {
    const out = [];
    document.querySelectorAll('.inventoryCnt').forEach((el) => {
      const node = el.firstChild; // text node before the "NEW IN STOCK" span
      if (node && node.nodeType === Node.TEXT_NODE) {
        const m = node.nodeValue.match(/(\d+)(\+?)/);
        if (m) out.push({ el, node, num: m[1], capped: m[2] === '+', orig: node.nodeValue });
      }
    });
    return out;
  }

  const setNum = (t, text) => { t.node.nodeValue = text + ' '; };
  const restore = (t) => { t.node.nodeValue = t.orig; };

  // ---- product page: ids + whether it's sellable -----------------------------

  function pageInfo() {
    const form = document.querySelector('form.ajaxForm, form.crtfrm');
    if (!form) return null;
    const val = (n) => { const i = form.querySelector(`[name="${n}"]`); return i ? i.value : null; };
    return {
      storeId: val('store_id'),
      sku: val('sku'),
      productID: val('productID'),
      cartType: val('cartType'), // "instore" = buyable, "list" = NoSale
    };
  }

  // ---- HTTP helpers ----------------------------------------------------------

  function gm(method, url, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        data,
        headers: data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
        onload: (r) => resolve(r.responseText),
        onerror: () => reject(new Error('request failed: ' + url)),
        ontimeout: () => reject(new Error('request timed out: ' + url)),
      });
    });
  }

  function addToCartBody(info) {
    return new URLSearchParams({
      store_id: String(parseInt(info.storeId, 10)),
      sku: info.sku,
      productID: info.productID,
      na: 'false',
      cartType: 'instore',
      buyItNow: 'false',
      ajax: 'true',
      productIDs: '',
      serviceSkuIDs: '',
      serviceplan: '',
      rf: '',
      qty: '1',
      ADDtoCART: 'ADD TO CART',
    }).toString();
  }

  // ---- cart HTML parsing -----------------------------------------------------

  // Every cart line has a remove <form> carrying its CSRF token, ItemId and
  // CompositeKey. CompositeKey starts with "<productID>~", which is how we find
  // *our* line among possibly many.
  function findLine(html, productID) {
    const re = /action="\/cart\/cartremove"[\s\S]*?value="([^"]+)"[\s\S]*?name="ItemId"[^>]*value="(\d+)"[\s\S]*?name="CompositeKey"[^>]*value="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (m[3].startsWith(productID + '~')) {
        return { token: m[1], itemId: m[2], compositeKey: m[3] };
      }
    }
    return null;
  }

  function quantityInStock(html, itemId) {
    const m = html.match(/var cartItems = (\[[\s\S]*?\]);/);
    if (!m) return null;
    let items;
    try { items = JSON.parse(m[1]); } catch (e) { return null; }
    const it = items.find((i) => String(i.ItemId) === String(itemId));
    return it ? it.QuantityInStock : null;
  }

  // ---- the actual lookup -----------------------------------------------------

  async function realStock(info) {
    let html = await gm('GET', CART + '/');
    let line = findLine(html, info.productID);
    let addedByUs = false;

    if (!line) {
      // not already in the cart — add one unit (same-origin fetch keeps cookies
      // + Referer, both required by the endpoint)
      await fetch('/store/add_productAjax.aspx?ismini=false', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: addToCartBody(info),
      });
      addedByUs = true;
      html = await gm('GET', CART + '/');
      line = findLine(html, info.productID);
    }

    if (!line) return null; // couldn't get it into the cart

    const qty = quantityInStock(html, line.itemId);

    if (addedByUs) {
      // put the cart back exactly how we found it
      await gm('POST', CART + '/cart/cartremove', new URLSearchParams({
        __RequestVerificationToken: line.token,
        ItemId: line.itemId,
        CompositeKey: line.compositeKey,
      }).toString());
    }

    return qty;
  }

  // ---- main ------------------------------------------------------------------

  async function main() {
    const targets = counters();
    const capped = targets.filter((t) => t.capped);
    if (!capped.length) return; // page already shows an exact number, or none

    const info = pageInfo();
    if (!info || !info.productID) return;

    // Not sellable online -> the exact count is never exposed; be honest.
    if (info.cartType !== 'instore') {
      capped.forEach((t) => {
        setNum(t, '≥' + t.num); // e.g. ≥25
        t.el.title = 'Not sellable online — Micro Center does not expose the exact count';
      });
      return;
    }

    capped.forEach((t) => setNum(t, '…')); // "…" while we check
    try {
      const qty = await realStock(info);
      if (qty != null) {
        capped.forEach((t) => {
          setNum(t, String(qty));
          t.el.title = 'Real on-hand stock at this store (read from cart)';
        });
      } else {
        capped.forEach(restore);
      }
    } catch (e) {
      console.error('[MC Real Stock]', e);
      capped.forEach(restore);
    }
  }

  main();
})();
