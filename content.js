(function() {
    let headerModeActive = false;

    function init() {
        setTimeout(() => {
            injectHeaderItemsButton();
            injectActualCustomersDisplay();
            injectCommissionCalculator();
            attachTransactionRowListeners();
            calculateAll();
        }, 1000);
    }

    function injectHeaderItemsButton() {
        const detailsElements = Array.from(document.querySelectorAll('div, span, p')).filter(el => 
            el.textContent.includes('Details assigned to') && el.children.length === 0
        );
        
        if (detailsElements.length > 0) {
            const targetEl = detailsElements[0];
            const btn = document.createElement('button');
            btn.id = 'oh-header-mode-btn';
            btn.textContent = 'Enable Header Items Mode';
            
            btn.addEventListener('click', () => {
                headerModeActive = !headerModeActive;
                document.body.classList.toggle('oh-header-mode-active', headerModeActive);
                btn.textContent = headerModeActive ? 'Disable Header Items Mode' : 'Enable Header Items Mode';
                btn.classList.toggle('active', headerModeActive);
            });

            targetEl.parentNode.insertBefore(btn, targetEl.nextSibling);
        }
    }

    function injectActualCustomersDisplay() {
        const cells = document.querySelectorAll('td, div, span');
        for (let cell of cells) {
            if (cell.textContent.includes('Customers Served:')) {
                const actualCustEl = document.createElement('span');
                actualCustEl.id = 'oh-actual-customers';
                cell.appendChild(actualCustEl);
                break;
            }
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
            const calcWrapper = document.createElement('div');
            calcWrapper.id = 'oh-commission-calc';
            
            calcWrapper.innerHTML = `
                <table>
                    <thead>
                        <tr><th colspan="2">Commission Calculator (Scripts.js)</th></tr>
                    </thead>
                    <tbody>
                        <tr class="oh-row-red">
                            <td>Comm Rate (%)</td>
                            <td><input type="number" id="oh-comm-rate" value="1.5"></td>
                        </tr>
                        <tr class="oh-row-green">
                            <td>Hourly Rate ($)</td>
                            <td><input type="number" id="oh-hourly-rate" value="15.00"></td>
                        </tr>
                        <tr class="oh-row-blue">
                            <td>Hours Worked</td>
                            <td><input type="number" id="oh-hours-worked" value="8"></td>
                        </tr>
                        <tr class="oh-row-yellow">
                            <td>Service Plan Rev ($)</td>
                            <td><input type="number" id="oh-sp-revenue" value="0"></td>
                        </tr>
                        <tr class="oh-row-orange">
                            <td>Service Plan Qty</td>
                            <td><input type="number" id="oh-sp-qty" value="0"></td>
                        </tr>
                        <tr class="oh-row-purple">
                            <td>SP Comm Rate (%)</td>
                            <td><input type="number" id="oh-sp-rate" value="5"></td>
                        </tr>
                        <tr class="oh-row-darkblue">
                            <td>Total Commission</td>
                            <td id="oh-total-comm">$0.00</td>
                        </tr>
                        <tr>
                            <td>Total Hourly</td>
                            <td id="oh-total-hourly">$0.00</td>
                        </tr>
                        <tr>
                            <td>Total Combined</td>
                            <td id="oh-total-combined" style="font-weight:bold;">$0.00</td>
                        </tr>
                        <tr>
                            <td>Total Per Hour</td>
                            <td id="oh-total-per-hour">$0.00</td>
                        </tr>
                        <tr>
                            <td>Total Per Customer</td>
                            <td id="oh-total-per-customer">$0.00</td>
                        </tr>
                        <tr>
                            <td>Total SP Comm</td>
                            <td id="oh-total-sp-comm">$0.00</td>
                        </tr>
                        <tr>
                            <td>Comm Per Plan</td>
                            <td id="oh-total-comm-per-plan">$0.00</td>
                        </tr>
                    </tbody>
                </table>
            `;

            rightTable.parentNode.insertBefore(calcWrapper, rightTable);

            const inputs = calcWrapper.querySelectorAll('input');
            inputs.forEach(input => input.addEventListener('input', calculateAll));
        }
    }

    function attachTransactionRowListeners() {
        const rows = document.querySelectorAll('tr');
        rows.forEach(row => {
            if (row.textContent.match(/\d{3}-[A-Z]{2}-\d{8}/)) {
                row.classList.add('transaction-row');
                
                row.addEventListener('click', (e) => {
                    if (headerModeActive) {
                        e.preventDefault();
                        row.classList.toggle('oh-removed-item');
                        calculateAll();
                    }
                });
            }
        });
    }

    function calculateAll() {
        let activeText = "";
        let visibleRevenue = 0;

        const rows = document.querySelectorAll('.transaction-row:not(.oh-removed-item)');
        rows.forEach(row => {
            activeText += row.textContent + " ";
            
            const cells = row.querySelectorAll('td');
            if(cells.length > 0) {
                const totalCellStr = cells[cells.length - 1].textContent.replace('$', '').replace(',', '');
                const totalVal = parseFloat(totalCellStr);
                if (!isNaN(totalVal)) {
                    visibleRevenue += totalVal;
                }
            }
        });

        const regex = /\d{3}-[A-Z]{2}-\d{8}/g;
        const matches = activeText.match(regex) || [];
        const uniqueIDs = [...new Set(matches)];
        const actualCustomersCount = uniqueIDs.length;

        const actualCustEl = document.getElementById('oh-actual-customers');
        if (actualCustEl) {
            actualCustEl.innerHTML = `Actual Customers: ${actualCustomersCount}`;
        }

        const commissionRate = parseFloat(document.getElementById('oh-comm-rate')?.value) || 0;
        const hourlyRate = parseFloat(document.getElementById('oh-hourly-rate')?.value) || 0;
        const hoursWorked = parseFloat(document.getElementById('oh-hours-worked')?.value) || 0;
        const servicePlansRevenue = parseFloat(document.getElementById('oh-sp-revenue')?.value) || 0;
        const servicePlansAmount = parseFloat(document.getElementById('oh-sp-qty')?.value) || 0;
        const salesCommissionRate = parseFloat(document.getElementById('oh-sp-rate')?.value) || 0;

        const commission = visibleRevenue * (commissionRate / 100);
        const salesCommission = servicePlansRevenue * (salesCommissionRate / 100);
        const hourlyTotal = hourlyRate * hoursWorked;
        const combined = commission + hourlyTotal;
        const perHour = hoursWorked > 0 ? (combined / hoursWorked) : 0;
        const perCustomer = actualCustomersCount > 0 ? (commission / actualCustomersCount) : 0;
        const commissionPerPlan = servicePlansAmount > 0 ? (salesCommission / servicePlansAmount) : 0;

        function formatCurrency(val) { return '$' + val.toFixed(2); }
        
        if (document.getElementById('oh-total-comm')) {
            document.getElementById('oh-total-comm').textContent = formatCurrency(commission);
            document.getElementById('oh-total-hourly').textContent = formatCurrency(hourlyTotal);
            document.getElementById('oh-total-combined').textContent = formatCurrency(combined);
            document.getElementById('oh-total-per-hour').textContent = formatCurrency(perHour);
            document.getElementById('oh-total-per-customer').textContent = formatCurrency(perCustomer);
            document.getElementById('oh-total-sp-comm').textContent = formatCurrency(salesCommission);
            document.getElementById('oh-total-comm-per-plan').textContent = formatCurrency(commissionPerPlan);
        }

        const summaryTotalCell = Array.from(document.querySelectorAll('td')).find(td => td.textContent.trim().startsWith('$') && td.parentNode.textContent.includes('Customers Served:'));
        if (summaryTotalCell) {
            summaryTotalCell.textContent = formatCurrency(visibleRevenue);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();