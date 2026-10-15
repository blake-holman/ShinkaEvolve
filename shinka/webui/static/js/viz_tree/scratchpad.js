// Scratch tab: meta scratchpad files written by the summarizer.

// Function to initialize meta analysis controls
export function initializeMetaAnalysis() {
    const generationSlider = document.getElementById('generation-slider');
    const generationValue = document.getElementById('generation-value');
    const refreshMetaBtn = document.getElementById('refresh-meta-btn');
    // Store available meta files for current database
    window.availableMetaFiles = [];
    window.metaContentCache = {};
    
    if (generationSlider && generationValue) {
        generationSlider.addEventListener('input', function() {
            let selectedGen = parseInt(this.value);
            
            // Get available generations
            const availableGensStr = this.getAttribute('data-available-generations');
            if (availableGensStr) {
                const availableGens = JSON.parse(availableGensStr);
                
                // Find the closest available generation
                const closest = availableGens.reduce((prev, curr) => {
                    return Math.abs(curr - selectedGen) < Math.abs(prev - selectedGen) ? curr : prev;
                });
                
                selectedGen = closest;
                this.value = selectedGen; // Update slider to show correct value
            }
            
            generationValue.textContent = selectedGen;
            loadMetaContent(selectedGen);
        });
    }

    
    if (refreshMetaBtn) {
        refreshMetaBtn.addEventListener('click', function() {
            if (window.currentDbPath) {
                loadAvailableMetaFiles(window.currentDbPath);
            }
        });
    }
    
    const downloadPdfBtn = document.getElementById('download-pdf-btn');
    if (downloadPdfBtn) {
        downloadPdfBtn.addEventListener('click', function() {
            downloadMetaAsPDF();
        });
    }

    // Initialize meta sub-tab functionality
    const metaSubTabs = document.querySelectorAll('.meta-sub-tab');
    metaSubTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Remove active class from all sub-tabs and reset border
            metaSubTabs.forEach(t => {
                t.classList.remove('active');
                t.style.borderBottom = '2px solid transparent';
                t.style.backgroundColor = '';
            });
            
            // Add active class to clicked tab and set active border
            this.classList.add('active');
            this.style.borderBottom = '2px solid #007bff';
            this.style.backgroundColor = '#f8f9fa';
            
            // Show the corresponding section
            showMetaSection(this.getAttribute('data-section'));
        });
    });
}

// Function to download meta content as PDF using backend conversion
function downloadMetaAsPDF() {
    if (!window.currentDbPath) {
        alert('Please select a database first.');
        return;
    }
    
    // Get the current meta update identifier
    const currentGen = document.getElementById('generation-value').textContent;
    
    console.log('[DEBUG] Starting PDF download process...');
    
    // Use the downloadMetaPdf function which calls the backend endpoint
    downloadMetaPdf(window.currentDbPath, currentGen);
}

// Function to download text content as a formatted text file
function generateSimplePDFFromText(rawText, filename, dbName, generation, downloadBtn, originalText) {
    try {
        console.log('[DEBUG] Creating downloadable text file from content');
        console.log('[DEBUG] Raw text length:', rawText.length);
        console.log('[DEBUG] First 200 chars:', rawText.substring(0, 200));
        
        // Add header to the content
        const header = `Meta Analysis - Update ${generation}
Database: ${dbName}
${'='.repeat(80)}
`;
        
        // Combine header and content
        const fullContent = header + rawText;
        
        // Create a blob with the text content
        const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' });
        
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename.replace('.pdf', '.txt'); // Change extension to .txt
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up URL
        window.URL.revokeObjectURL(url);
        
        // Reset button state
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = false;
        console.log('[DEBUG] Text file download triggered successfully');
            
    } catch (error) {
        console.error('Text file generation failed:', error);
        alert('Failed to generate text file. Please try again.');
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = false;
    }
}

// Function to load available meta files for a database
export function loadAvailableMetaFiles(dbPath) {
    console.log("[DEBUG] Loading available meta files for:", dbPath);
    
    // Clear the cache when loading a new database
    window.metaContentCache = {};
    
    // Make request to server to get list of meta files
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/get_meta_files?db_path=${encodeURIComponent(dbPath)}`, true);
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                try {
                    const metaFiles = JSON.parse(xhr.responseText);
                    window.availableMetaFiles = metaFiles;
                    console.log("[DEBUG] Found meta files:", metaFiles);
                    
                    // Update slider range based on available files
                    updateMetaSlider(metaFiles);
                    
                    // Load the highest update file by default
                    if (metaFiles.length > 0) {
                        const highestGen = metaFiles[metaFiles.length - 1].processed_count;
                        const slider = document.getElementById('generation-slider');
                        if (slider) {
                            slider.value = highestGen;
                            document.getElementById('generation-value').textContent = highestGen;
                            loadMetaContent(highestGen);
                        }
                    }
                } catch (e) {
                    console.error("[ERROR] Failed to parse meta files response:", e);
                    showMetaError("Failed to load meta files list.");
                }
            } else if (xhr.status === 404) {
                console.log("[DEBUG] No meta files found for this database");
                showMetaMessage("No meta analysis files found for this database.");
                window.availableMetaFiles = [];
            } else {
                console.error("[ERROR] Failed to load meta files:", xhr.status, xhr.statusText);
                showMetaError("Failed to load meta files.");
            }
        }
    };
    
    xhr.send();
}

// Function to update slider based on available meta files
function updateMetaSlider(metaFiles) {
    const slider = document.getElementById('generation-slider');
    if (!slider) return;
    
    if (metaFiles.length === 0) {
        // If no meta files, disable slider and show message
        slider.disabled = true;
        showMetaMessage("No meta analysis files found for this database.");
        return;
    }
    
    const generations = metaFiles
        .map(f => f.processed_count ?? f.generation)
        .sort((a, b) => a - b);
    const minGen = Math.min(...generations);
    const maxGen = Math.max(...generations);
    
    // Update slider attributes - use step of 1 for better control
    slider.disabled = false;
    slider.min = minGen;
    slider.max = maxGen;
    slider.step = 1;
    
    // Store available generations for validation
    slider.setAttribute('data-available-generations', JSON.stringify(generations));
    
    console.log(`[DEBUG] Updated slider range: ${minGen} - ${maxGen}, available: ${generations.join(', ')}`);
}

// Function to show a message in the meta content area
function showMetaMessage(message) {
    const metaContent = document.getElementById('meta-content');
    if (metaContent) {
        metaContent.innerHTML = `<p style="text-align: center; color: #666; margin-top: 50px;">${message}</p>`;
    }
}

// Function to load meta content for a specific meta update
function loadMetaContent(generation) {
    if (!window.currentDbPath) {
        showMetaMessage("Please select a database first.");
        return;
    }

    if (generation === undefined || generation === null || generation === '') {
        showMetaMessage("Meta analysis for this update is not available.");
        return;
    }
    
    // Check if this update is available
    const availableGen = window.availableMetaFiles.find(
        f => (f.processed_count ?? f.generation) == generation
    );
    if (!availableGen) {
        showMetaMessage(`Meta analysis for update ${generation} is not available.`);
        return;
    }
    
    console.log("[DEBUG] Loading meta analysis for update:", generation);
    
    // Show loading state
    const metaContent = document.getElementById('meta-content');
    if (metaContent) {
        metaContent.innerHTML = '<p style="text-align: center; color: #666; margin-top: 50px;">Loading meta analysis...</p>';
    }
    
    // Make request to server to get meta content
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/get_meta_content?db_path=${encodeURIComponent(window.currentDbPath)}&processed_count=${generation}`, true);
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    // Cache the content
                    window.metaContentCache[generation] = response;
                    displayMetaContent(response);
                    
                    // Preload previous generation for diff comparison
                    const availableGens = window.availableMetaFiles
                        .map(f => f.processed_count ?? f.generation)
                        .sort((a, b) => a - b);
                    const currentIndex = availableGens.indexOf(parseInt(generation));
                    if (currentIndex > 0) {
                        const prevGen = availableGens[currentIndex - 1];
                        loadMetaContentForDiff(prevGen);
                    }
                } catch (e) {
                    console.error("[ERROR] Failed to parse meta content response:", e);
                    showMetaError("Failed to parse meta analysis content.");
                }
            } else {
                console.error("[ERROR] Failed to load meta content:", xhr.status, xhr.statusText);
                showMetaError(`Failed to load meta analysis for update ${generation}.`);
            }
        }
    };
    
    xhr.send();
}

// Function to convert structured meta content to HTML
function convertStructuredMetaToHTML(content) {
    // Split content into sections (# INDIVIDUAL PROGRAM SUMMARIES, # GLOBAL INSIGHTS SCRATCHPAD, # META RECOMMENDATIONS)
    const sections = content.split(/^(#\s*(?:INDIVIDUAL PROGRAM SUMMARIES|GLOBAL INSIGHTS SCRATCHPAD|META RECOMMENDATIONS))$/m);
    let html = '';
    let inSection = false;
    
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        
        if (section.match(/^#\s*(?:INDIVIDUAL PROGRAM SUMMARIES|GLOBAL INSIGHTS SCRATCHPAD|META RECOMMENDATIONS)$/)) {
            // This is a section header - start a new section box
            if (inSection) {
                html += '</div></div>'; // Close previous section
            }
            const headerText = section.replace(/^#\s*/, '');
            html += `
                <div class="meta-section" style="margin-bottom: 25px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                    <div class="meta-section-header" style="background-color: #f8f9fa; padding: 15px; border-bottom: 1px solid #ddd;">
                        <h2 style="margin: 0; color: #2c3e50; font-size: 18px;">${headerText}</h2>
                    </div>
                    <div class="meta-section-content" style="padding: 20px;">
            `;
            inSection = true;
        } else if (section.trim()) {
            // This is section content
            if (!inSection) {
                // Content before first section - treat as introduction
                html += `<div style="margin-bottom: 20px; padding: 15px; background-color: #f9f9f9; border-radius: 5px;">`;
                html += marked.parse(section);
                html += `</div>`;
            } else {
                // Content within a section - just use regular markdown parsing
                html += marked.parse(section);
            }
        }
    }
    
    // Close the last section if we're in one
    if (inSection) {
        html += '</div></div>';
    }
    
    return html;
}

// Function to format program summaries with **Program Name:** structure
function formatProgramSummaries(content) {
    // Preprocess content to remove double asterisks
    content = content.replace(/\*\*Program Name:\*\*/g, 'Program Name:');
    content = content.replace(/\*\*Implementation:\*\*/g, 'Implementation:');
    content = content.replace(/\*\*Performance:\*\*/g, 'Performance:');
    content = content.replace(/\*\*Feedback:\*\*/g, 'Feedback:');
    
    // Split by Program Name: to get individual program entries
    const parts = content.split(/Program Name:\s*/);
    let html = '';
    
    // Handle the first part (before any "Program Name:") as introductory text
    if (parts[0] && parts[0].trim()) {
        const introText = processSimpleMarkdown(parts[0].trim());
        html += `<div style="margin-bottom: 20px; line-height: 1.5;">${introText}</div>`;
    }
    
    // Process the actual program entries (skip the first part which is intro text)
    const programEntries = parts.slice(1).filter(entry => entry.trim());
    
    programEntries.forEach(entry => {
        const lines = entry.trim().split('\n');
        if (lines.length === 0) return;
        
        let entryHtml = '<div class="meta-entry" style="margin-bottom: 20px; padding: 15px; background-color: #f9f9f9; border-radius: 5px;">';
        
        // First line should be the program name (after the **Program Name: prefix)
        const programName = lines[0].replace(/\*\*$/, '').trim();
        entryHtml += `<div class="meta-name" style="font-weight: bold; color: #2c3e50; margin-bottom: 12px; font-size: 16px;">Program Name: ${programName}</div>`;
        
        // Process the rest of the lines
        let currentField = '';
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            if (line.startsWith('Implementation:')) {
                currentField = 'implementation';
                const content = processSimpleMarkdown(line.replace(/^Implementation:\s*/, ''));
                entryHtml += `<div class="meta-implementation" style="margin-bottom: 8px;"><strong>Implementation:</strong> ${content}</div>`;
            } else if (line.startsWith('Performance:')) {
                currentField = 'performance';
                const content = processSimpleMarkdown(line.replace(/^Performance:\s*/, ''));
                entryHtml += `<div class="meta-performance" style="margin-bottom: 8px;"><strong>Performance:</strong> ${content}</div>`;
            } else if (line.startsWith('Feedback:')) {
                currentField = 'feedback';
                const content = processSimpleMarkdown(line.replace(/^Feedback:\s*/, ''));
                entryHtml += `<div class="meta-feedback" style="margin-bottom: 8px;"><strong>Feedback:</strong> ${content}</div>`;
            } else if (line.startsWith('-') || currentField) {
                // Continuation line or bullet point
                const cleanLine = line.replace(/^-\s*/, '');
                // Process markdown in the content
                const processedLine = processSimpleMarkdown(cleanLine);
                const indentStyle = line.startsWith('-') ? 'margin-left: 0px;' : 'margin-left: 15px;';
                entryHtml += `<div style="${indentStyle} margin-bottom: 5px; line-height: 1.5;">${processedLine}</div>`;
            } else {
                // Other content
                const processedLine = processSimpleMarkdown(line);
                entryHtml += `<div style="margin-bottom: 5px; line-height: 1.5;">${processedLine}</div>`;
            }
        }
        
        entryHtml += '</div>';
        html += entryHtml;
    });
    
    return html;
}

// Helper function to process simple markdown formatting
function processSimpleMarkdown(text) {
    return text
        // Convert **text** to <strong>text</strong>
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Convert *text* to <em>text</em>
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

// Function to format structured entries (Name/Summary/Performance)
function formatStructuredEntries(content) {
    // First try to fix entries that may be missing proper separations
    let fixedContent = content
        // Add double newlines before Name: if missing (handles both cases)
        .replace(/([^\n])\nName:/g, '$1\n\nName:')
        .replace(/(Performance:.*?)(Name:)/g, '$1\n\n$2')
        // Clean up any triple+ newlines
        .replace(/\n{3,}/g, '\n\n');
    
    // Split by double newlines to get individual entries
    const entries = fixedContent.split(/\n\s*\n/).filter(entry => entry.trim());
    let html = '';
    
    entries.forEach(entry => {
        const lines = entry.trim().split('\n');
        let entryHtml = '<div class="meta-entry" style="margin-bottom: 20px; padding: 15px; background-color: #f9f9f9; border-radius: 5px;">';
        
        let currentField = '';
        lines.forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('Name:')) {
                currentField = 'name';
                entryHtml += `<div class="meta-name" style="font-weight: bold; color: #2c3e50; margin-bottom: 8px;">${trimmedLine}</div>`;
            } else if (trimmedLine.startsWith('Summary:')) {
                currentField = 'summary';
                entryHtml += `<div class="meta-summary" style="margin-bottom: 8px; line-height: 1.5;">${trimmedLine}</div>`;
            } else if (trimmedLine.startsWith('Performance:')) {
                currentField = 'performance';
                entryHtml += `<div class="meta-performance" style="font-style: italic; color: #34495e;">${trimmedLine}</div>`;
            } else if (trimmedLine) {
                // Continuation of previous field
                const indentStyle = currentField === 'name' ? 'margin-left: 0px;' : 'margin-left: 10px;';
                entryHtml += `<div style="${indentStyle} margin-bottom: 5px; line-height: 1.5;">${trimmedLine}</div>`;
            }
        });
        
        entryHtml += '</div>';
        html += entryHtml;
    });
    
    return html;
}

// Store parsed meta sections globally
window.parsedMetaSections = {};

// Function to show specific meta section based on sub-tab selection
function showMetaSection(sectionType) {
    const sectionContent = document.getElementById('meta-section-content');
    if (!sectionContent || !window.parsedMetaSections) {
        console.log("[DEBUG] showMetaSection: Missing elements or data", {
            sectionContent: !!sectionContent,
            parsedMetaSections: !!window.parsedMetaSections
        });
        return;
    }
    
    const sections = window.parsedMetaSections;
    let content = '';
    
    console.log("[DEBUG] showMetaSection:", sectionType);
    
    switch(sectionType) {
        case 'individual-programs':
            content = sections.individualPrograms || '<p>No individual program summaries available.</p>';
            break;
        case 'global-insights':
            content = sections.globalInsights || '<p>No global insights available.</p>';
            break;
        case 'meta-recommendations':
            content = sections.metaRecommendations || '<p>No meta recommendations available.</p>';
            break;
        default:
            content = '<p>Section not found.</p>';
    }
    
    console.log("[DEBUG] Final content length:", content.length);
    sectionContent.innerHTML = content;
}

// Function to parse meta content into sections
function parseMetaIntoSections(content) {
    const sections = {
        individualPrograms: '',
        globalInsights: '',
        metaRecommendations: ''
    };
    
    // Also store raw content for diff comparison
    const rawSections = {
        individualPrograms: '',
        globalInsights: '',
        metaRecommendations: ''
    };
    
    // Split content by main section headers
    const parts = content.split(/^#\s*(INDIVIDUAL PROGRAM SUMMARIES|GLOBAL INSIGHTS SCRATCHPAD|META RECOMMENDATIONS)$/m);
    
    for (let i = 1; i < parts.length; i += 2) {
        const sectionTitle = parts[i].trim();
        const sectionContent = parts[i + 1] || '';
        
        if (sectionTitle === 'INDIVIDUAL PROGRAM SUMMARIES') {
            rawSections.individualPrograms = sectionContent.trim();
            // Use the formatProgramSummaries function to create program boxes
            sections.individualPrograms = formatProgramSummaries(sectionContent.trim());
        } else if (sectionTitle === 'GLOBAL INSIGHTS SCRATCHPAD') {
            rawSections.globalInsights = sectionContent.trim();
            sections.globalInsights = marked.parse(sectionContent.trim());
        } else if (sectionTitle === 'META RECOMMENDATIONS') {
            rawSections.metaRecommendations = sectionContent.trim();
            sections.metaRecommendations = marked.parse(sectionContent.trim());
        }
    }
    
    // Store raw sections globally for diff comparison
    sections._rawSections = rawSections;
    
    return sections;
}

// Function to display meta content with markdown rendering and optional diff highlighting
function displayMetaContent(metaData, skipAsyncLoad = false) {
    const metaContent = document.getElementById('meta-content');
    if (!metaContent) return;
    
    try {
        const currentGen = metaData.processed_count ?? metaData.generation;
        
        // Parse content into sections
        window.parsedMetaSections = parseMetaIntoSections(metaData.content);
        
        console.log("[DEBUG] Displaying meta content for update", currentGen);
        
        // Show the content for the currently active sub-tab
        const activeSubTab = document.querySelector('.meta-sub-tab.active');
        const activeSection = activeSubTab ? activeSubTab.getAttribute('data-section') : 'individual-programs';
        
        console.log("[DEBUG] Active sub-tab:", activeSubTab, "Active section:", activeSection);
        
        // Display the header info
        metaContent.innerHTML = `
            <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
                <h3 style="margin: 0; color: #333;">Scratchpad - Update ${currentGen}</h3>
                <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">File: ${metaData.filename}</p>
            </div>
            <div class="meta-content-body" style="line-height: 1.6;" id="meta-section-content">
                <!-- Content will be loaded by showMetaSection -->
            </div>
        `;
        
        // Show the appropriate section (use setTimeout to ensure DOM is updated)
        setTimeout(() => {
            showMetaSection(activeSection);
        }, 0);
        
        console.log("[DEBUG] Successfully displayed meta content for update", currentGen);
    } catch (e) {
        console.error("[ERROR] Failed to render meta content:", e);
        showMetaError("Failed to render meta analysis content.");
    }
}

// Function to generate simple diff HTML that preserves markdown structure
function generateSimpleDiffHTML(oldText, newText) {
    if (typeof Diff === 'undefined') {
        console.warn("[WARN] Diff library not loaded, showing markdown");
        return marked.parse(newText);
    }
    
    try {
        // Use line-based diff for better markdown preservation
        const diff = Diff.diffLines(oldText, newText);
        let result = '';
        
        diff.forEach(function(part) {
            const lines = part.value.split('\n');
            lines.forEach(function(line, index) {
                if (line.trim() === '' && index === lines.length - 1) return; // Skip final empty line
                
                if (part.added) {
                    result += `<div class="diff-added" style="display: block; margin: 2px 0;">${marked.parseInline(line)}</div>\n`;
                } else if (part.removed) {
                    result += `<div class="diff-removed" style="display: block; margin: 2px 0;">${marked.parseInline(line)}</div>\n`;
                } else {
                    result += `${marked.parseInline(line)}<br>\n`;
                }
            });
        });
        
        return result;
    } catch (e) {
        console.error("[ERROR] Failed to generate simple diff:", e);
        return marked.parse(newText);
    }
}

// Function to download meta content as PDF
function downloadMetaPdf(dbPath, generation) {
    console.log(`Downloading meta PDF for DB: ${dbPath}, Update: ${generation}`);
    const url = `/download_meta_pdf?db_path=${encodeURIComponent(dbPath)}&processed_count=${generation}`;
    window.open(url, '_blank');
}

// Function to load meta content specifically for diff comparison (without displaying)
function loadMetaContentForDiff(generation, onComplete) {
    if (window.metaContentCache[generation]) {
        if (onComplete) onComplete();
        return; // Already cached
    }
    
    console.log("[DEBUG] Loading meta content for diff comparison:", generation);
    
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/get_meta_content?db_path=${encodeURIComponent(window.currentDbPath)}&processed_count=${generation}`, true);
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4 && xhr.status === 200) {
            try {
                const response = JSON.parse(xhr.responseText);
                window.metaContentCache[generation] = response;
                console.log("[DEBUG] Cached meta content for update", generation);
                
                // Call the completion callback if provided
                if (onComplete) onComplete();
            } catch (e) {
                console.error("[ERROR] Failed to cache meta content for diff:", e);
            }
        }
    };
    
    xhr.send();
}

// Helper function to show meta error message
function showMetaError(message) {
    const metaContent = document.getElementById('meta-content');
    if (metaContent) {
        metaContent.innerHTML = `<p style="text-align: center; color: #e74c3c; margin-top: 50px;">${message}</p>`;
    }
}
