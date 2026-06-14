// ==UserScript==
// @name         Commission Calc - Native Button
// @namespace    http://tampermonkey.net/
// @version      1.7.0
// @description  Restored summary table logic + 3D Printing Highlights + Department Settings (GS/Systems/BYO) + Perfect Nav Button Alignment + Auto Hours Worked (EST): live for today / first->last sale for past days + Last Sale time + Sales Person quick-pick dropdown
// @author       grant
// @match        */Sales/Retail*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1. Inject the navigation button immediately on load to match native Kendo theme
    function injectNavButton() {
        // Find the "PowerSpec/CTO Lookup" menu item container
        const menuLinks = document.querySelectorAll('#Menu .k-menu-link-text');
        let ctoLinkContainer = null;

        for (let link of menuLinks) {
            if (link.textContent.trim() === 'PowerSpec/CTO Lookup') {
                ctoLinkContainer = link.closest('.k-item');
                break;
            }
        }

        if (ctoLinkContainer) {
            // Inject custom styles to handle native hover highlighting (white background)
            const hoverStyle = document.createElement('style');
            hoverStyle.textContent = `
                #Menu .oh-custom-nav-item .k-link:hover {
                    background-color: #ffffff !important;
                }
            `;
            document.head.appendChild(hoverStyle);

            // Create a matching list item structure with standard class names
            const newLi = document.createElement('li');
            newLi.className = 'k-item oh-custom-nav-item';

            // Create an anchor tag to blend seamlessly with the other links
            const nativeAnchor = document.createElement('a');
            nativeAnchor.className = 'k-link k-menu-link';
            nativeAnchor.href = 'javascript:void(0);';
            nativeAnchor.style.cursor = 'pointer';

            // Create the inner text span used by Kendo UI styling
            const spanText = document.createElement('span');
            spanText.className = 'k-menu-link-text';
            spanText.textContent = 'OrderHistory++';

            nativeAnchor.appendChild(spanText);
            newLi.appendChild(nativeAnchor);

            // Directly fire the calculator logic when clicked
            nativeAnchor.onclick = function(e) {
                e.preventDefault();
                runCalculator();
            };

            // Insert it right after the PowerSpec/CTO list item
            ctoLinkContainer.parentNode.insertBefore(newLi, ctoLinkContainer.nextSibling);

            // Re-sync Kendo menu if possible so layout borders refresh natively
            if (window.jQuery && window.jQuery("#Menu").data("kendoMenu")) {
                try {
                    window.jQuery("#Menu").data("kendoMenu").destroy();
                    window.jQuery("#Menu").kendoMenu({});
                } catch(e) { /* Fallback to standard DOM styles if initialization races */ }
            }
        }
    }

    // Listen for window messages if triggered externally
    window.addEventListener('message', function(event) {
        if (event.data === 'START_CALC') {
            runCalculator();
        }
    });

    // ---------------------------------------------------------------------
    // Auto Hours Worked helpers (EST)
    // ---------------------------------------------------------------------

    // Convert a Date into the wall-clock minutes-since-midnight in America/New_York (EST/EDT).
    function getEasternMinutes(dateObj) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        }).formatToParts(dateObj);
        let h = 0, m = 0;
        for (const p of parts) {
            if (p.type === 'hour') h = parseInt(p.value, 10);
            if (p.type === 'minute') m = parseInt(p.value, 10);
        }
        if (h === 24) h = 0; // Intl can emit 24 for midnight in hour12:false
        return h * 60 + m;
    }

    // Today's date (in America/New_York) as "M/D/YYYY", matching the page's Date input format.
    function getEasternTodayString() {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
        }).formatToParts(new Date());
        let y = '', m = '', d = '';
        for (const p of parts) {
            if (p.type === 'year') y = p.value;
            if (p.type === 'month') m = p.value;
            if (p.type === 'day') d = p.value;
        }
        return m + '/' + d + '/' + y;
    }

    // Normalize a date string like "06/14/2026" or "6/14/2026" to "6/14/2026" (no leading zeros).
    function normalizeDateString(str) {
        if (!str) return '';
        const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (!m) return str.trim();
        return parseInt(m[1], 10) + '/' + parseInt(m[2], 10) + '/' + m[3];
    }

    // Read the currently selected date from the Sales Lookup "Date" input.
    function getSelectedDateString() {
        const dateInput = document.getElementById('Date');
        return dateInput ? normalizeDateString(dateInput.value) : '';
    }

    // True when the selected Date is today's date (Eastern). Defaults to true if the field is missing.
    function isSelectedDateToday() {
        const selected = getSelectedDateString();
        if (!selected) return true;
        return selected === getEasternTodayString();
    }

    // Parse a "MM/DD/YYYY hh:mm AM/PM" string into minutes-since-midnight (local wall clock of that string).
    function parseTimeStringToMinutes(str) {
        const match = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!match) return null;
        let hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        const meridiem = match[3].toUpperCase();
        if (meridiem === 'PM' && hour !== 12) hour += 12;
        if (meridiem === 'AM' && hour === 12) hour = 0;
        return hour * 60 + minute;
    }

    // Build the detail-page URL for a given transaction id (e.g. "071-PO-13109702").
    function buildTransactionUrl(txId) {
        return '/Search/Exact/Transaction/' + txId;
    }

    // Fetch the detail page for a transaction and extract its first timestamp string.
    function fetchTransactionTime(txId) {
        return fetch(buildTransactionUrl(txId), { credentials: 'include' })
            .then(resp => resp.text())
            .then(htmlText => {
                const m = htmlText.match(/\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i);
                return m ? m[0] : null;
            })
            .catch(() => null);
    }

    // Live mode (used when viewing TODAY): first-sale time floored to the hour, current EST time floored to 10 min.
    function computeAutoHours(firstSaleStr) {
        const startMinsRaw = parseTimeStringToMinutes(firstSaleStr);
        if (startMinsRaw === null) return null;

        // Floor start time down to the hour (e.g. 10:43 -> 10:00)
        const startMins = Math.floor(startMinsRaw / 60) * 60;

        // Current time in Eastern, floored down to the nearest 10 minutes (e.g. 15:45 -> 15:40)
        const nowMinsRaw = getEasternMinutes(new Date());
        const nowMins = Math.floor(nowMinsRaw / 10) * 10;

        let diff = nowMins - startMins;
        if (diff < 0) diff = 0; // safety: never negative

        return diff / 60; // hours as a decimal
    }

    // Past-day mode (used when viewing a PREVIOUS day): first sale floored to the hour -> last sale of the day.
    // Last sale is rounded UP to the nearest 10 minutes so the final partial hour is captured.
    function computeHoursFromRange(firstSaleStr, lastSaleStr) {
        const startMinsRaw = parseTimeStringToMinutes(firstSaleStr);
        const endMinsRaw = parseTimeStringToMinutes(lastSaleStr);
        if (startMinsRaw === null || endMinsRaw === null) return null;

        const startMins = Math.floor(startMinsRaw / 60) * 60;   // floor first sale to the hour
        const endMins = Math.ceil(endMinsRaw / 10) * 10;        // round last sale up to 10 min

        let diff = endMins - startMins;
        if (diff < 0) diff = 0; // safety: never negative

        return diff / 60; // hours as a decimal
    }

    // ---------------------------------------------------------------------
    // Sales Person quick-pick dropdown (sits to the right of the Sales Person box)
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Sales person quick-pick list.
    // EDIT THIS LIST HERE IN THE SCRIPT. It is not editable from the page.
    // Just add/remove/change names between the quotes below.
    // ---------------------------------------------------------------------
    const OH_SP_NAMES = [
        'person1',
        'person2',
    ];

    function loadSalespersonNames() {
        return OH_SP_NAMES.slice();
    }

    // Write a value into the SalesPerson box and keep the Kendo textbox widget in sync.
    function setSalesPersonValue(value) {
        const spInput = document.getElementById('SalesPerson');
        if (!spInput) return;
        spInput.value = value;
        if (window.jQuery) {
            const widget = window.jQuery(spInput).data('kendoTextBox');
            if (widget && typeof widget.value === 'function') widget.value(value);
            window.jQuery(spInput).trigger('change');
        } else {
            spInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function rebuildSalespersonOptions(select, names) {
        select.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Quick pick…';
        select.appendChild(placeholder);

        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });
    }

    function injectSalespersonDropdown() {
        if (document.getElementById('oh-salesperson-picker')) return;
        const spInput = document.getElementById('SalesPerson');
        if (!spInput) return;

        // The input sits inside <div class="input-field">; place the dropdown right after it.
        const inputField = spInput.closest('.input-field') || spInput.parentNode;
        if (!inputField) return;

        // Make the field lay out the input + dropdown side by side.
        inputField.style.display = 'flex';
        inputField.style.alignItems = 'center';
        inputField.style.gap = '6px';

        let names = loadSalespersonNames();

        const select = document.createElement('select');
        select.id = 'oh-salesperson-picker';
        select.title = 'Quick-pick a sales person (edit list in the script)';
        select.style.height = '28px';
        select.style.fontSize = '12px';
        select.style.border = '1px solid #ccc';
        select.style.borderRadius = '3px';
        select.style.padding = '2px 4px';
        select.style.cursor = 'pointer';
        select.style.flex = '0 0 auto';
        select.style.maxWidth = '130px';

        rebuildSalespersonOptions(select, names);

        select.addEventListener('change', () => {
            const val = select.value;
            if (val) {
                setSalesPersonValue(val);
            }
        });

        inputField.appendChild(select);
    }

    function runCalculator() {
        if (document.getElementById('oh-commission-calc')) return;

        const css = `
            #oh-commission-calc { display: inline-block; vertical-align: top; background: #fff; border: 1px solid #c5c5c5; font-size: 12px; font-family: 'Open Sans', Arial, sans-serif; width: 300px; }
            #oh-commission-calc table { width: 100%; border-collapse: collapse; }
            #oh-commission-calc th { background-color: #1a1a1a; color: #fff; padding: 6px 8px; text-align: left; font-weight: bold; border-bottom: 1px solid #c5c5c5; }
            #oh-commission-calc td { padding: 3px 8px; height: 25px; border-bottom: 1px solid #eee; }
            #oh-commission-calc tfoot td { border-top: 1px solid #c5c5c5; background-color: #f8f9fa; }
            #oh-commission-calc input[type="number"], #oh-commission-calc select { width: 75px; padding: 1px 4px; margin: 0; border: 1px solid #ccc; border-radius: 3px; height: 20px; font-size: 11px; box-sizing: border-box; }
            .oh-r-white { background-color: #ffffff; }
            .oh-r-pink { background-color: #fcd5d4; }
            .oh-r-purple { background-color: #dac0ff !important; }
            .oh-r-green { background-color: #d4fcd5 !important; }
            .oh-r-blue { background-color: #d4e6fc; }
            .oh-r-orange { background-color: #ffcaa5; }
            .oh-r-olive { background-color: #c2b59b; }
            .oh-r-yellow { background-color: #ffff99 !important; }
            .oh-r-red { background-color: #ffbfbf !important; }
            .oh-r-dgreen { background-color: #016a19; color: #fff; }
            .oh-r-dblue { background-color: #1d51a5; color: #fff; }
            .oh-r-black { background-color: #111111; color: #fff; }
            #oh-header-mode-btn { margin-top: 10px; margin-bottom: 10px; padding: 6px 12px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
            #oh-header-mode-btn.active { background-color: #dc3545; }
            body.oh-header-mode-active .transaction-row { cursor: pointer; }
            body.oh-header-mode-active .transaction-row:hover { background-color: #ffcccc !important; outline: 2px solid red; }
            .transaction-row.oh-removed-item { opacity: 0.3; text-decoration: line-through; background-color: #f8f9fa !important; }
        `;

        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);

        if (window.kendo && window.jQuery) {
            var grid = window.jQuery("#Sales").data("kendoGrid");
            if (grid) { grid.dataSource.pageSize(300); }
        }

        let headerModeActive = false;
        injectHeaderItemsButton();
        injectCommissionCalculator();
        attachTransactionRowListeners();
        updateConfigVisibility();
        calculateAll();
        autofillHoursWorked();
        populateLastSale();

        // Find the most recent sale (top of the list), fetch its detail page time, and show it as "Last Sale".
        function populateLastSale() {
            const lastSaleCell = document.getElementById('oh-last-sale-time');
            if (!lastSaleCell) return;

            // Determine the last (most recent) sale = top-most transaction row on the page.
            const allTxRows = document.querySelectorAll('.transaction-row');
            if (allTxRows.length === 0) return;
            const topRow = allTxRows[0];
            const txMatch = topRow.textContent.match(/\d{3}-[A-Z]{2}-\d{8}/);
            if (!txMatch) return;
            const txId = txMatch[0];

            lastSaleCell.textContent = '...';
            lastSaleCell.title = 'Loading from ' + txId + '...';

            fetchTransactionTime(txId).then(timeStr => {
                if (!timeStr) { lastSaleCell.textContent = '--'; lastSaleCell.title = ''; return; }
                // Show just the time portion (e.g. "11:42 AM") from "MM/DD/YYYY hh:mm AM/PM".
                const timeOnly = timeStr.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/i);
                lastSaleCell.textContent = timeOnly ? timeOnly[0] : timeStr;
                lastSaleCell.title = txId + ' @ ' + timeStr;
            });
        }

        // Autofill Hours Worked.
        //  - If the selected date is TODAY: hours = first sale (floored to hour) -> now (EST).
        //  - If the selected date is a PAST day: hours = first sale (floored to hour) -> last sale of that day.
        function autofillHoursWorked() {
            const hoursInput = document.getElementById('oh-hours-worked');
            if (!hoursInput) return;

            // Determine the first sale = bottom-most transaction row on the page.
            const allTxRows = document.querySelectorAll('.transaction-row');
            if (allTxRows.length === 0) return;
            const bottomRow = allTxRows[allTxRows.length - 1];
            const firstTxMatch = bottomRow.textContent.match(/\d{3}-[A-Z]{2}-\d{8}/);
            if (!firstTxMatch) return;
            const firstTxId = firstTxMatch[0];

            const viewingToday = isSelectedDateToday();

            // Visual hint while loading
            const prevTitle = hoursInput.title;
            hoursInput.title = 'Auto-filling from first sale (' + firstTxId + ')...';

            fetchTransactionTime(firstTxId).then(firstTimeStr => {
                if (!firstTimeStr) { hoursInput.title = prevTitle || ''; return; }

                // Don't stomp on the user if they've already typed into the field.
                if (document.activeElement === hoursInput) { hoursInput.title = prevTitle || ''; return; }

                if (viewingToday) {
                    const autoHours = computeAutoHours(firstTimeStr);
                    if (autoHours === null) { hoursInput.title = prevTitle || ''; return; }
                    hoursInput.value = autoHours.toFixed(2);
                    hoursInput.title = 'Auto: first sale ' + firstTimeStr + ' -> now (EST)';
                    calculateAll();
                    return;
                }

                // Past day: also fetch the last (most recent) sale = top-most transaction row.
                const topRow = allTxRows[0];
                const lastTxMatch = topRow.textContent.match(/\d{3}-[A-Z]{2}-\d{8}/);
                if (!lastTxMatch) { hoursInput.title = prevTitle || ''; return; }
                const lastTxId = lastTxMatch[0];

                // If there's only one transaction on the day, first and last are the same row.
                const lastTimePromise = (lastTxId === firstTxId)
                    ? Promise.resolve(firstTimeStr)
                    : fetchTransactionTime(lastTxId);

                lastTimePromise.then(lastTimeStr => {
                    if (!lastTimeStr) { hoursInput.title = prevTitle || ''; return; }
                    if (document.activeElement === hoursInput) { hoursInput.title = prevTitle || ''; return; }

                    const rangeHours = computeHoursFromRange(firstTimeStr, lastTimeStr);
                    if (rangeHours === null) { hoursInput.title = prevTitle || ''; return; }

                    hoursInput.value = rangeHours.toFixed(2);
                    hoursInput.title = 'Auto: first sale ' + firstTimeStr + ' -> last sale ' + lastTimeStr;
                    calculateAll();
                });
            }).catch(() => { hoursInput.title = prevTitle || ''; });
        }

        function injectHeaderItemsButton() {
            const detailsElements = Array.from(document.querySelectorAll('div, span, p')).filter(el => el.textContent.includes('Details assigned to') && el.children.length === 0);
            if (detailsElements.length > 0) {
                const targetEl = detailsElements[0];
                const btn = document.createElement('button');
                btn.id = 'oh-header-mode-btn';
                btn.type = 'button';
                btn.textContent = 'Enable Header Items Mode';
                btn.onclick = () => {
                    headerModeActive = !headerModeActive;
                    document.body.classList.toggle('oh-header-mode-active', headerModeActive);
                    btn.textContent = headerModeActive ? 'Disable Header Items Mode' : 'Enable Header Items Mode';
                    btn.classList.toggle('active', headerModeActive);
                };
                targetEl.parentNode.insertBefore(btn, targetEl.nextSibling);
            }
        }

        function injectCommissionCalculator() {
            const summaryTables = document.querySelectorAll('table');
            let rightTable = null;
            for (let t of summaryTables) {
                if (t.textContent.includes('Computers Sold') && t.textContent.includes('Attach %')) {
                    rightTable = t;
                    break;
                }
            }
            if (rightTable) {
                const summaryDiv = rightTable.closest('.k-widget.k-grid');
                if (summaryDiv) {
                    const calcWrapper = document.createElement('div');
                    calcWrapper.id = 'oh-commission-calc';
                    calcWrapper.innerHTML = `
                        <table>
                            <thead><tr><th colspan="2" style="position: relative;">Commission Calculator<button type="button" id="oh-config-btn" style="position: absolute; right: 8px; top: 4px; font-size: 10px; padding: 2px 6px; cursor: pointer; color: #333; background: #eee; border: 1px solid #ccc; border-radius: 3px;">Config</button></th></tr></thead>
                            <tbody>
                                <tr class="oh-r-white oh-config-row" style="display: none;">
                                    <td>Department</td>
                                    <td>
                                        <select id="oh-dept-select">
                                            <option value="GS" selected>GS</option>
                                            <option value="Systems">Systems</option>
                                            <option value="BYO">BYO</option>
                                        </select>
                                    </td>
                                </tr>
                                <tr class="oh-r-white oh-config-row oh-systems-only" style="display: none;"><td>Commission Rate (%)</td><td><input type="number" id="oh-systems-rate" value="2.5" step="0.1"></td></tr>
                                <tr class="oh-r-white oh-config-row" style="display: none;"><td>Hourly Rate ($)</td><td><input type="number" id="oh-hourly-rate" value="4.00"></td></tr>
                                <tr class="oh-r-pink oh-config-row" style="display: none;"><td>Hours Worked</td><td><input type="number" id="oh-hours-worked" value="8"></td></tr>
                                <tr class="oh-r-purple oh-config-row" style="display: none;"><td>Service Plan Rev ($)</td><td><input type="number" id="oh-sp-revenue" value="0"></td></tr>
                                <tr class="oh-r-green oh-config-row" style="display: none;"><td>Service Plan Qty</td><td><input type="number" id="oh-sp-qty" value="0"></td></tr>
                                <tr class="oh-r-blue oh-config-row" style="display: none;"><td>SP Comm Rate (%)</td><td><input type="number" id="oh-sp-rate" value="10"></td></tr>
                                <tr class="oh-r-orange"><td>Total Commission</td><td id="oh-total-comm">$0.00</td></tr>
                                <tr class="oh-r-olive"><td>Total Hourly</td><td id="oh-total-hourly">$0.00</td></tr>
                                <tr class="oh-r-yellow"><td>Total Combined</td><td id="oh-total-combined" style="font-weight:bold;">$0.00</td></tr>
                                <tr class="oh-r-dgreen"><td>Total Per Hour</td><td id="oh-total-per-hour">$0.00</td></tr>
                                <tr class="oh-r-dblue"><td>Total Per Customer</td><td id="oh-total-per-customer">$0.00</td></tr>
                                <tr class="oh-r-red"><td>Customers per hour</td><td id="oh-cust-per-hour">0.00</td></tr>
                                <tr class="oh-r-black"><td>Total SP Comm</td><td id="oh-total-sp-comm">$0.00</td></tr>
                            </tbody>
                            <tfoot><tr class="oh-r-purple"><td>Comm Per Plan</td><td id="oh-total-comm-per-plan">$0.00</td></tr><tr class="oh-r-yellow"><td>Last Sale</td><td id="oh-last-sale-time">--</td></tr></tfoot>
                        </table>`;

                    const flexContainer = document.createElement('div');
                    flexContainer.style.display = 'flex'; flexContainer.style.alignItems = 'flex-start'; flexContainer.style.gap = '15px'; flexContainer.style.width = '100%';
                    summaryDiv.parentNode.insertBefore(flexContainer, summaryDiv);
                    flexContainer.appendChild(calcWrapper); flexContainer.appendChild(summaryDiv);

                    let configVisible = false;
                    document.getElementById('oh-config-btn').onclick = (e) => {
                        configVisible = !configVisible;
                        document.querySelectorAll('.oh-config-row').forEach(row => {
                            if (row.classList.contains('oh-systems-only')) {
                                const dept = document.getElementById('oh-dept-select').value;
                                row.style.display = (configVisible && dept === 'Systems') ? '' : 'none';
                            } else {
                                row.style.display = configVisible ? '' : 'none';
                            }
                        });
                    };

                    document.getElementById('oh-dept-select').onchange = () => {
                        updateConfigVisibility();
                        calculateAll();
                    };

                    calcWrapper.querySelectorAll('input').forEach(input => input.oninput = calculateAll);
                }
            }
        }

        function updateConfigVisibility() {
            const dept = document.getElementById('oh-dept-select')?.value;
            const systemsRateRow = document.querySelector('.oh-systems-only');
            const configRowsVisible = document.querySelector('.oh-config-row').style.display !== 'none';

            if (systemsRateRow) {
                systemsRateRow.style.display = (configRowsVisible && dept === 'Systems') ? '' : 'none';
            }
        }

        function attachTransactionRowListeners() {
            document.querySelectorAll('tr').forEach(row => {
                if (row.textContent.match(/\d{3}-[A-Z]{2}-\d{8}/)) {
                    row.classList.add('transaction-row');
                    row.onclick = (e) => {
                        if (headerModeActive) {
                            row.classList.toggle('oh-removed-item');
                            calculateAll();
                        }
                    };
                }
            });
        }

        function calculateAll() {
            let activeText = "", visibleRevenue = 0, calculatedCommissionTotal = 0, calcSpRevenue = 0, calcSpQty = 0;
            const rows = document.querySelectorAll('.transaction-row:not(.oh-removed-item)');
            const currentDept = document.getElementById('oh-dept-select')?.value || 'GS';
            const systemsRatePercent = parseFloat(document.getElementById('oh-systems-rate')?.value) || 0;

            // Reset highlight classes
            document.querySelectorAll('.transaction-row').forEach(r => r.classList.remove('oh-r-red', 'oh-r-yellow', 'oh-r-green'));

            // Map structures for BYO calculations
            let transactionIslands = {};

            rows.forEach(row => {
                const txMatch = row.textContent.match(/\d{3}-[A-Z]{2}-\d{8}/);
                const txId = txMatch ? txMatch[0] : 'unknown';
                activeText += row.textContent + " ";

                const cells = row.querySelectorAll('td');
                if (cells.length > 0) {
                    let descCellStr = cells[4]?.textContent.toLowerCase() || "";
                    let qtyStr = cells[5]?.textContent.trim() || "0";
                    let totalCellStr = cells[cells.length - 1].textContent.trim();
                    let isNegative = totalCellStr.includes('(') && totalCellStr.includes(')');
                    let totalVal = parseFloat(totalCellStr.replace(/[^0-9.]/g, '')) || 0;
                    let qtyVal = parseFloat(qtyStr) || 0;

                    if (isNegative) { totalVal = -totalVal; qtyVal = -qtyVal; }
                    visibleRevenue += totalVal;

                    let isServicePlan = /protection plan|replacement plan|service plan|applecare/.test(descCellStr);
                    let isPeripheral = /keyboard|mouse|mice/.test(descCellStr);
                    let is3DPrint = /3d printer|filament/.test(descCellStr);
                    let isCpuOrGpu = /\bcpu\b|\bgpu\b|processor|graphics card|video card|nvidia|amd\s+radeon|geforce|intel\s+core|ryzen/.test(descCellStr);

                    if (isServicePlan) {
                        row.classList.add('oh-r-red');
                        calcSpRevenue += totalVal;
                        calcSpQty += qtyVal;
                    } else {
                        if (isPeripheral) {
                            row.classList.add('oh-r-yellow');
                        } else if (is3DPrint) {
                            row.classList.add('oh-r-green');
                        }

                        // Branching logic based on active Department rule
                        if (currentDept === 'GS') {
                            let itemCommission = 0, absTotal = Math.abs(totalVal);
                            if (absTotal < 10.00) itemCommission = totalVal * 0.12;
                            else if (absTotal < 100.00) itemCommission = totalVal * 0.06;
                            else if (absTotal <= 200.00) itemCommission = totalVal * 0.03;
                            else itemCommission = totalVal * 0.02;
                            calculatedCommissionTotal += itemCommission;
                        }
                        else if (currentDept === 'Systems') {
                            calculatedCommissionTotal += totalVal * (systemsRatePercent / 100);
                        }
                        else if (currentDept === 'BYO') {
                            if (!transactionIslands[txId]) {
                                transactionIslands[txId] = [];
                            }
                            transactionIslands[txId].push({
                                totalVal: totalVal,
                                isCpuOrGpu: isCpuOrGpu
                            });
                        }
                    }
                }
            });

            // Post-process the BYO transaction islands
            if (currentDept === 'BYO') {
                for (let txId in transactionIslands) {
                    let items = transactionIslands[txId];
                    if (items.length === 0) continue;

                    let keyItemIndex = -1;

                    // Priority 1: Pick the highest priced CPU/GPU to force override key item role
                    let maxCpuGpuPrice = -Infinity;
                    for (let i = 0; i < items.length; i++) {
                        if (items[i].isCpuOrGpu && items[i].totalVal > maxCpuGpuPrice) {
                            maxCpuGpuPrice = items[i].totalVal;
                            keyItemIndex = i;
                        }
                    }

                    // Priority 2: If no CPU/GPU exists, pick the overall highest priced merchandise item
                    if (keyItemIndex === -1) {
                        let maxPrice = -Infinity;
                        for (let i = 0; i < items.length; i++) {
                            if (items[i].totalVal > maxPrice) {
                                maxPrice = items[i].totalVal;
                                keyItemIndex = i;
                            }
                        }
                    }

                    // Process dynamic commission breakdown for this transaction island
                    for (let i = 0; i < items.length; i++) {
                        if (i === keyItemIndex) {
                            calculatedCommissionTotal += items[i].totalVal * 0.015; // 1.5% Key Item Rate
                        } else {
                            calculatedCommissionTotal += items[i].totalVal * 0.025;  // 2.0% Attach Item Rate
                        }
                    }
                }
            }

            const uniqueIDs = [...new Set(activeText.match(/\d{3}-[A-Z]{2}-\d{8}/g) || [])].length;
            const custCell = Array.from(document.querySelectorAll('td')).find(td => td.textContent.includes('Customers Served:'));
            if (custCell) {
                if (!custCell.dataset.originalText) custCell.dataset.originalText = custCell.textContent.trim();
                let baseText = custCell.dataset.originalText.replace(/\s*\(\d+\)$/, '');
                custCell.textContent = `${baseText} (${uniqueIDs})`;
            }

            const spRevInput = document.getElementById('oh-sp-revenue');
            const spQtyInput = document.getElementById('oh-sp-qty');
            if (spRevInput && document.activeElement !== spRevInput) spRevInput.value = calcSpRevenue.toFixed(2);
            if (spQtyInput && document.activeElement !== spQtyInput) spQtyInput.value = calcSpQty;

            const hourlyRate = parseFloat(document.getElementById('oh-hourly-rate')?.value) || 0;
            const hoursWorked = parseFloat(document.getElementById('oh-hours-worked')?.value) || 0;
            const salesCommissionRate = parseFloat(document.getElementById('oh-sp-rate')?.value) || 0;
            const salesCommission = (parseFloat(spRevInput?.value) || 0) * (salesCommissionRate / 100);
            const totalCommissionPool = calculatedCommissionTotal + salesCommission;
            const combined = totalCommissionPool + (hourlyRate * hoursWorked);

            function formatCurrency(val) { return (val < 0 ? '-' : '') + '$' + Math.abs(val).toFixed(2); }

            if (document.getElementById('oh-total-comm')) {
                document.getElementById('oh-total-comm').textContent = formatCurrency(totalCommissionPool);
                document.getElementById('oh-total-hourly').textContent = formatCurrency(hourlyRate * hoursWorked);
                document.getElementById('oh-total-combined').textContent = formatCurrency(combined);
                document.getElementById('oh-total-per-hour').textContent = formatCurrency(hoursWorked > 0 ? (combined / hoursWorked) : 0);
                document.getElementById('oh-total-per-customer').textContent = formatCurrency(uniqueIDs > 0 ? (totalCommissionPool / uniqueIDs) : 0);
                document.getElementById('oh-cust-per-hour').textContent = hoursWorked > 0 ? (uniqueIDs / hoursWorked).toFixed(2) : "0.00";
                document.getElementById('oh-total-sp-comm').textContent = formatCurrency(salesCommission);
                document.getElementById('oh-total-comm-per-plan').textContent = formatCurrency(calcSpQty > 0 ? (salesCommission / calcSpQty) : 0);
            }
            const summaryTotalCell = Array.from(document.querySelectorAll('td')).find(td => td.textContent.trim().startsWith('$') && td.parentNode.textContent.includes('Customers Served:'));
            if (summaryTotalCell) summaryTotalCell.textContent = formatCurrency(visibleRevenue);
        }
    }

    // Run button injection logic immediately
    injectNavButton();
    // Inject the Sales Person quick-pick dropdown next to the Sales Person box.
    injectSalespersonDropdown();
})();
