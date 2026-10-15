// Download of top programs as a zip.

// Function to download top performing programs as ZIP
function downloadTopPrograms() {
    if (!window.treeData || window.treeData.length === 0) {
        alert('No data available. Please load a database first.');
        return;
    }

    // Ask user how many programs to download
    const count = prompt('How many top performing programs would you like to download?\n\nEnter any number (1-100):', '5');
    
    if (count === null) return; // User cancelled
    
    const numPrograms = parseInt(count);
    if (isNaN(numPrograms) || numPrograms < 1 || numPrograms > 100) {
        alert('Please enter a valid number between 1 and 100.');
        return;
    }

    // Get top performing programs
    const correctPrograms = window.treeData
        .filter(d => d.correct && d.combined_score !== null && d.code)
        .sort((a, b) => b.combined_score - a.combined_score)
        .slice(0, numPrograms);

    if (correctPrograms.length === 0) {
        alert('No correct programs with code found.');
        return;
    }

    const actualCount = Math.min(numPrograms, correctPrograms.length);
    
    // Create ZIP file
    const zip = new JSZip();
    
    // Add a summary file
    let summary = `Top ${actualCount} Performing Programs\n`;
    summary += `Generated on: ${new Date().toISOString()}\n`;
    summary += `Database: ${window.currentDbPath || 'Unknown'}\n\n`;
    summary += `Rank\tGeneration\tScore\tName\tType\tLanguage\tAPI_Cost\tComplexity\tModel\tID\tParent_ID\tDescription\tFilename\n`;
    
    correctPrograms.forEach((program, index) => {
        const rank = index + 1;
        const gen = program.generation;
        const score = program.combined_score.toFixed(6);
        const name = program.metadata.patch_name || 'unnamed';
        const language = program.language || 'py';
        const extension = {
            'python': 'py',
            'cpp': 'cpp',
            'javascript': 'js',
            'cuda': 'cu',
            'fortran': 'f90'
        }[language] || language;
        
        // Determine comment style based on language
        const commentStyle = {
            'python': '#',
            'py': '#',
            'cpp': '//',
            'c++': '//',
            'javascript': '//',
            'js': '//',
            'cuda': '//',
            'cu': '//',
            'fortran': '!',
            'f90': '!',
            'f95': '!',
            'f03': '!',
            'f08': '!'
        }[language.toLowerCase()] || '//';
        
        const filename = `${rank}_gen${gen}_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}`;
        
        // Collect additional metadata
        const patchType = program.metadata.patch_type || 'N/A';
        const apiCost = program.metadata.api_costs ? `$${parseFloat(program.metadata.api_costs).toFixed(4)}` : 'N/A';
        const complexity = program.complexity ? program.complexity.toFixed(3) : 'N/A';
        const model = program.metadata.model_name || 'N/A';
        const programId = program.id.substring(0, 12) + '...'; // Truncate for readability
        const parentId = program.parent_id ? program.parent_id.substring(0, 12) + '...' : 'N/A';
        const description = program.metadata.patch_description ? 
            program.metadata.patch_description.replace(/[\t\n\r]/g, ' ').substring(0, 100) + 
            (program.metadata.patch_description.length > 100 ? '...' : '') : 'N/A';
        
        // Add to summary with all metadata
        summary += `${rank}\t${gen}\t${score}\t${name}\t${patchType}\t${language}\t${apiCost}\t${complexity}\t${model}\t${programId}\t${parentId}\t${description}\t${filename}\n`;
        
        // Create program file content with appropriate comment style
        let content = `${commentStyle} Rank: ${rank}\n`;
        content += `${commentStyle} Generation: ${gen}\n`;
        content += `${commentStyle} Score: ${score}\n`;
        content += `${commentStyle} Name: ${name}\n`;
        content += `${commentStyle} ID: ${program.id}\n`;
        if (program.parent_id) {
            content += `${commentStyle} Parent ID: ${program.parent_id}\n`;
        }
        content += `${commentStyle} Type: ${program.metadata.patch_type || 'N/A'}\n`;
        if (program.metadata.patch_description) {
            // Split description by line breaks and comment each line properly
            const descriptionLines = program.metadata.patch_description.split(/\r?\n/);
            content += `${commentStyle} Description: ${descriptionLines[0]}\n`;
            // Add continuation lines with proper commenting
            for (let i = 1; i < descriptionLines.length; i++) {
                if (descriptionLines[i].trim()) { // Only add non-empty lines
                    content += `${commentStyle}              ${descriptionLines[i]}\n`;
                }
            }
        }
        content += `\n${program.code}`;
        
        // Add file to ZIP
        zip.file(filename, content);
    });
    
    // Add summary file
    zip.file('README.txt', summary);
    
    // Generate and download ZIP
    zip.generateAsync({type: 'blob'}).then(function(content) {
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `top_${actualCount}_programs.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }).catch(function(error) {
        console.error('Error creating ZIP file:', error);
        alert('Error creating ZIP file. Please try again.');
    });
}

                // Add event listener for download button
document.addEventListener('DOMContentLoaded', function() {
    
    const downloadProgramsBtn = document.getElementById('download-programs-btn');
    if (downloadProgramsBtn) {
        downloadProgramsBtn.addEventListener('click', downloadTopPrograms);
    }
    

});
