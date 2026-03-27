(function() {
    let headerModeActive = false;

    function init() {
        injectPageSizeOverride();

        setTimeout(() => {
            injectHeaderItemsButton();
            injectCommissionCalculator();
            attachTransactionRowListeners();
            calculateAll();
        }, 1500); 
    }

    function injectPageSizeOverride() {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('inject.js');
        script.onload = function() {
            this.remove(); 
        };
        (document.head || document.documentElement).appendChild(script);
    }

    function injectHeaderItemsButton() {
        const detailsElements = Array.from(document.querySelectorAll('div, span, p')).filter(el => 
            el.textContent.includes('Details assigned to') && el.children.length === 0
        );
        
        if (detailsElements.length > 0) {
            const targetEl = detailsElements[0];
            const btn = document.createElement('button');
            btn.id = 'oh-header-mode-btn';
            btn.type = 'button'; // FIX: Stops the button from submitting the form and refreshing the page
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
                
                const tableTemplate = `
                    <table>
                        <thead>
                            <tr>
                                <th colspan="2" style="position: relative;">
                                    Commission Calculator 
                                    <button type="button" id="oh-config-btn" style="position: absolute; right: 8px; top: 4px; font-size: 10px; padding: 2px 6px; cursor: pointer; color: #333; background: #eee; border: 1px solid #ccc; border-radius: 3px;">Config</button>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr class="oh-r-white oh-config-row" style="display: none;">
                                <td>Hourly Rate ($)</td>
                                <td><input type="number" id="oh-hourly-rate" value="4.00"></td>
                            </tr>
                            <tr class="oh-r-pink oh-config-row" style="display: none;">
                                <td>Hours Worked</td>
                                <td><input type="number" id="oh-hours-worked" value="8"></td>
                            </tr>
                            <tr class="oh-r-purple oh-config-row" style="display: none;">
                                <td>Service Plan Rev ($)</td>
                                <td><input type="number" id="oh-sp-revenue" value="0"></td>
                            </tr>
                            <tr class="oh-r-green oh-config-row" style="display: none;">
                                <td>Service Plan Qty</td>
                                <td><input type="number" id="oh-sp-qty" value="0"></td>
                            </tr>
                            <tr class="oh-r-blue oh-config-row" style="display: none;">
                                <td>SP Comm Rate (%)</td>
                                <td><input type="number" id="oh-sp-rate" value="10"></td>
                            </tr>
                            <tr class="oh-r-orange">
                                <td>Total Commission</td>
                                <td id="oh-total-comm">$0.00</td>
                            </tr>
                            <tr class="oh-r-olive">
                                <td>Total Hourly</td>
                                <td id="oh-total-hourly">$0.00</td>
                            </tr>
                            <tr class="oh-r-yellow">
                                <td>Total Combined</td>
                                <td id="oh-total-combined" style="font-weight:bold;">$0.00</td>
                            </tr>
                            <tr class="oh-r-dgreen">
                                <td>Total Per Hour</td>
                                <td id="oh-total-per-hour">$0.00</td>
                            </tr>
                            <tr class="oh-r-dblue">
                                <td>Total Per Customer</td>
                                <td id="oh-total-per-customer">$0.00</td>
                            </tr>
                            <tr class="oh-r-black">
                                <td>Total SP Comm</td>
                                <td id="oh-total-sp-comm">$0.00</td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr>
                                <td>Comm Per Plan</td>
                                <td id="oh-total-comm-per-plan">$0.00</td>
                            </tr>
                        </tfoot>
                    </table>
                `;

                const parser = new DOMParser();
                const doc = parser.parseFromString(tableTemplate, 'text/html');
                
                while (doc.body.firstChild) {
                    calcWrapper.appendChild(doc.body.firstChild);
                }

                // FIX: Establish strict widths so the right table stretches back out
                const flexContainer = document.createElement('div');
                flexContainer.style.display = 'flex';
                flexContainer.style.alignItems = 'flex-start';
                flexContainer.style.gap = '15px'; 
                flexContainer.style.width = '100%'; // Take up the whole column
                
                calcWrapper.style.flexShrink = '0'; // Don't let the calculator squish
                summaryDiv.style.flex = '1';        // Force the right table to stretch and fill the rest
                summaryDiv.style.minWidth = '0';    // Prevent flexbox overflow bugs

                summaryDiv.parentNode.insertBefore(flexContainer, summaryDiv);
                flexContainer.appendChild(calcWrapper);
                flexContainer.appendChild(summaryDiv);

                const configBtn = calcWrapper.querySelector('#oh-config-btn');
                const configRows = calcWrapper.querySelectorAll('.oh-config-row');
                
                configBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    configRows.forEach(row => {
                        row.style.display = row.style.display === 'none' ? '' : 'none';
                    });
                });

                const inputs = calcWrapper.querySelectorAll('input');
                inputs.forEach(input => input.addEventListener('input', calculateAll));
            }
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
                        
                        if (row.classList.contains('oh-removed-item')) {
                            row.style.transition = "background-color 0.2s";
                            row.style.backgroundColor = "#ffcccc";
                            setTimeout(() => {
                                row.style.backgroundColor = ""; 
                            }, 300);
                        }
                        
                        calculateAll(); 
                    }
                });
            }
        });
    }

    function calculateAll() {
        let activeText = "";
        let visibleRevenue = 0;
        let tieredCommissionTotal = 0;
        
        // New variables to auto-calculate Service Plans
        let calcSpRevenue = 0;
        let calcSpQty = 0;

        const rows = document.querySelectorAll('.transaction-row:not(.oh-removed-item)');
        rows.forEach(row => {
            activeText += row.textContent + " ";
            
            const cells = row.querySelectorAll('td');
            if(cells.length > 0) {
                // Grab the Description text (Column 5) and Qty (Column 6)
                let descCellStr = cells[4]?.textContent.toLowerCase() || "";
                let qtyStr = cells[5]?.textContent.trim() || "0";
                
                let totalCellStr = cells[cells.length - 1].textContent.trim();
                let isNegative = totalCellStr.includes('(') && totalCellStr.includes(')');
                let numStr = totalCellStr.replace(/[^0-9.]/g, ''); 
                
                let totalVal = parseFloat(numStr);
                let qtyVal = parseFloat(qtyStr);
                
                if (!isNaN(totalVal)) {
                    if (isNegative) {
                        totalVal = -totalVal; 
                        qtyVal = -qtyVal;
                    }
                    visibleRevenue += totalVal;

                    // AUTO-DETECT: Check if the item is a Service Plan
                    let isServicePlan = descCellStr.includes('protection plan') || 
                                        descCellStr.includes('replacement plan') || 
                                        descCellStr.includes('service plan') || 
                                        descCellStr.includes('applecare');

                    if (isServicePlan) {
                        // Bucket into Service Plan pool
                        calcSpRevenue += totalVal;
                        calcSpQty += qtyVal;
                    } else {
                        // Bucket into Standard Tiered pool
                        let itemCommission = 0;
                        let absTotal = Math.abs(totalVal);

                        if (absTotal < 10.00) {
                            itemCommission = totalVal * 0.12;
                        } else if (absTotal < 100.00) {
                            itemCommission = totalVal * 0.06;
                        } else if (absTotal <= 200.00) {
                            itemCommission = totalVal * 0.03;
                        } else {
                            itemCommission = totalVal * 0.02;
                        }

                        tieredCommissionTotal += itemCommission;
                    }
                }
            }
        });

        const regex = /\d{3}-[A-Z]{2}-\d{8}/g;
        const matches = activeText.match(regex) || [];
        const uniqueIDs = [...new Set(matches)];
        const actualCustomersCount = uniqueIDs.length;

        const custCell = Array.from(document.querySelectorAll('td')).find(td => td.textContent.includes('Customers Served:'));
        if (custCell) {
            if (!custCell.dataset.originalText) {
                custCell.dataset.originalText = custCell.textContent.trim(); 
            }
            let baseText = custCell.dataset.originalText.replace(/\s*\(\d+\)$/, ''); 
            custCell.textContent = `${baseText} (${actualCustomersCount})`;
        }

        // Auto-fill the Config inputs so the math runs without user intervention
        const spRevInput = document.getElementById('oh-sp-revenue');
        const spQtyInput = document.getElementById('oh-sp-qty');
        
        if (spRevInput && document.activeElement !== spRevInput) spRevInput.value = calcSpRevenue.toFixed(2);
        if (spQtyInput && document.activeElement !== spQtyInput) spQtyInput.value = calcSpQty;

        const finalSpRev = parseFloat(spRevInput?.value) || 0;
        const finalSpQty = parseFloat(spQtyInput?.value) || 0;
        const hourlyRate = parseFloat(document.getElementById('oh-hourly-rate')?.value) || 0;
        const hoursWorked = parseFloat(document.getElementById('oh-hours-worked')?.value) || 0;
        const salesCommissionRate = parseFloat(document.getElementById('oh-sp-rate')?.value) || 0;

        const salesCommission = finalSpRev * (salesCommissionRate / 100);
        const hourlyTotal = hourlyRate * hoursWorked;
        
        // FIX: Combine the Tiered Commission AND the Service Plan Commission into the grand total
        const totalCommissionPool = tieredCommissionTotal + salesCommission;
        const combined = totalCommissionPool + hourlyTotal + salesCommission;
        
        const perHour = hoursWorked > 0 ? (combined / hoursWorked) : 0;
        const perCustomer = actualCustomersCount > 0 ? (totalCommissionPool / actualCustomersCount) : 0;
        const commissionPerPlan = finalSpQty > 0 ? (salesCommission / finalSpQty) : 0;

        function formatCurrency(val) { 
            let sign = val < 0 ? '-' : '';
            return sign + '$' + Math.abs(val).toFixed(2); 
        }
        
        if (document.getElementById('oh-total-comm')) {
            document.getElementById('oh-total-comm').textContent = formatCurrency(totalCommissionPool); // Updated reference
            document.getElementById('oh-total-hourly').textContent = formatCurrency(hourlyTotal);
            document.getElementById('oh-total-combined').textContent = formatCurrency(combined); // Updated reference
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