profileDeleteDescriptionButton.addEventListener('click', handleDescriptionDelete);
profileUploadDescriptionButton.addEventListener('click', () => 
    {
        descriptionInput.click();
    }
);

descriptionInput.addEventListener('change', () => 
    {
        const file = descriptionInput.files[0];
        handleDescriptionUpload(file);
    }
);

async function handleDescriptionDelete() 
{
    try 
    {
        const response = await fetch('/api/me/description', { method: 'DELETE', });
        const data = await response.json();
        if (!response.ok) 
            throw new Error( data.error || 'Could not delete description' );

        profileViewDescription.textContent = 'No description yet.';
        profileDeleteDescriptionButton.disabled = true;
    } 
    catch (error) 
    {
        alert(error.message);
    }
}

async function handleDescriptionUpload(file) 
{
    if (!file)
        return;

    const extension = file.name.split('.').pop().toLowerCase();
    if (extension !== 'txt' || (file.type && file.type !== 'text/plain')) 
    {
        alert('Please select a TXT file.');
        return;
    }

    if (file.size > 50 * 1024) 
    {
        alert('Description must be smaller than 50 KB.');
        return;
    }

    try 
    {
        showUploadProgress();
        const data = await uploadWithProgress('/api/me/description', file, 'text/plain', updateUploadProgress);
        profileViewDescription.textContent = data.description;
        profileDeleteDescriptionButton.disabled = false;
        descriptionInput.value = '';
        setTimeout(() => { hideUploadProgress(); }, 500);
    } 
    catch (error) 
    {
        hideUploadProgress();
        alert(error.message);
    }
}

function hideUploadProgress() 
{
    uploadProgress.classList.add('hidden');
}

function updateUploadProgress(percent) 
{
    uploadProgressBar.style.width = `${percent}%`;
    uploadProgressText.textContent = `${percent}%`;
}

function showUploadProgress() 
{
    uploadProgress.classList.remove('hidden');
    uploadProgressBar.style.width = '0%';
    uploadProgressText.textContent = '0%';
}

function uploadWithProgress(url, body, contentType, onProgress) 
{
    return new Promise((resolve, reject) => 
    {
        const xhr = new XMLHttpRequest();

        xhr.open('POST', url);

        xhr.setRequestHeader(
            'Content-Type',
            contentType
        );

        xhr.upload.addEventListener(
            'progress',
            (event) => {
                if (!event.lengthComputable) {
                    return;
                }

                const percent = Math.round(
                    (event.loaded / event.total) * 100
                );

                onProgress(percent);
            }
        );

        xhr.addEventListener('load', () => 
        {
            let data;

            try {
                data = JSON.parse(xhr.responseText);
            } catch (error) {
                reject(
                    new Error('Invalid server response')
                );
                return;
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(data);
                return;
            }

            reject(
                new Error(
                    data.error || 'Upload failed'
                )
            );
        });

        xhr.addEventListener('error', () => {
            reject(new Error('Network error'));
        });

        xhr.addEventListener('abort', () => {
            reject(new Error('Upload cancelled'));
        });

        xhr.send(body);
    });
}