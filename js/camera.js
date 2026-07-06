// ============================================================
// CAMERA.JS — Camera start, flip, capture, photo overlay
// ============================================================

async function startCamera() {
    try {
        // Set video constraints based on device orientation
        const screenOrientation = window.screen.orientation?.type || 'portrait-primary';
        const isLandscape = screenOrientation.includes('landscape');

        const constraints = {
            video: {
                facingMode: { ideal: STATE.cameraFacingMode },
                width: { ideal: isLandscape ? 1280 : 960 },
                height: { ideal: isLandscape ? 960 : 1280 },
            },
            audio: false,
        };
        STATE.videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        document.getElementById('videoFeed').srcObject = STATE.videoStream;
    } catch (e) {
        console.warn('Camera error:', e);
        showMessage('📷 Camera not available. Check permissions.', 'error');
    }
}

// On page load: if camera permission was already granted (user allowed
// it on a previous visit), start the camera automatically. Otherwise
// leave the "Open Camera" button so the first tap triggers the prompt.
async function autoStartCameraIfAllowed() {
    try {
        if (navigator.permissions && navigator.permissions.query) {
            const status = await navigator.permissions.query({ name: 'camera' });
            if (status.state === 'granted') {
                await openCamera();
                return;
            }
        }
    } catch (e) {
        // Permissions API unsupported for 'camera' (e.g. Firefox/iOS) — fall through
    }
    // Not yet granted (or unknown) → show the Open Camera button
    stopCamera();
}

// Camera-on-demand: opens only when the supervisor taps "Open Camera".
async function openCamera() {
    const openBtn = document.getElementById('openCameraBtn');
    const video   = document.getElementById('videoFeed');
    const camBtns = document.getElementById('cameraButtons');

    if (openBtn) { openBtn.disabled = true; openBtn.textContent = '⏳ Starting camera...'; }

    await startCamera();

    if (STATE.videoStream) {
        if (video)   video.style.display   = 'block';
        if (camBtns) camBtns.style.display = 'flex';
        if (openBtn) openBtn.style.display = 'none';
    } else if (openBtn) {
        openBtn.disabled = false;
        openBtn.textContent = '📷 Open Camera';
    }
}

// Stop the stream + reset camera UI back to the "Open Camera" button.
function stopCamera() {
    if (STATE.videoStream) {
        STATE.videoStream.getTracks().forEach(t => t.stop());
        STATE.videoStream = null;
    }
    const openBtn = document.getElementById('openCameraBtn');
    const video   = document.getElementById('videoFeed');
    const camBtns = document.getElementById('cameraButtons');
    if (video)   { video.style.display = 'none'; video.srcObject = null; }
    if (camBtns) camBtns.style.display = 'none';
    if (openBtn) { openBtn.style.display = 'block'; openBtn.disabled = false; openBtn.textContent = '📷 Open Camera'; }
}

async function flipCamera() {
    if (STATE.videoStream) {
        STATE.videoStream.getTracks().forEach(t => t.stop());
    }
    const original = STATE.cameraFacingMode;
    STATE.cameraFacingMode = (STATE.cameraFacingMode === 'environment') ? 'user' : 'environment';
    try {
        await startCamera();
    } catch (e) {
        // Revert if new mode fails
        STATE.cameraFacingMode = original;
        await startCamera();
        showMessage('⚠️ Front camera not available. Using back camera.', 'error');
    }
}

function capturePhoto() {
    const video  = document.getElementById('videoFeed');
    const canvas = document.createElement('canvas');

    let videoWidth  = video.videoWidth;
    let videoHeight = video.videoHeight;

    // Get device orientation from phone settings
    const screenOrientation = window.screen.orientation?.type || 'portrait-primary';
    const isLandscape = screenOrientation.includes('landscape');

    // In portrait mode: video is already portrait (960x1280), no rotation needed
    // In landscape mode: video is already landscape (1280x960), no rotation needed
    let canvasWidth = videoWidth;
    let canvasHeight = videoHeight;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    ctx.save();

    // Apply transforms based on phone's actual orientation
    if (screenOrientation === 'landscape-primary') {
        // Rotate 90° clockwise
        ctx.translate(canvasWidth, 0);
        ctx.rotate(Math.PI / 2);
    } else if (screenOrientation === 'landscape-secondary') {
        // Rotate 270° (or -90°)
        ctx.translate(0, canvasHeight);
        ctx.rotate(-Math.PI / 2);
    } else if (screenOrientation === 'portrait-secondary') {
        // Rotate 180° (upside down)
        ctx.translate(canvasWidth, canvasHeight);
        ctx.rotate(Math.PI);
    }
    // portrait-primary needs no rotation

    // Mirror for front camera
    if (STATE.cameraFacingMode === 'user') {
        ctx.scale(-1, 1);
        ctx.translate(-videoWidth, 0);
    }

    // Draw video at actual captured dimensions
    ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
    ctx.restore();

    // Add overlay with proper orientation
    const rotationAngle = isLandscape ? (screenOrientation === 'landscape-primary' ? 90 : 270) : (screenOrientation === 'portrait-secondary' ? 180 : 0);
    addPhotoOverlay(ctx, canvasWidth, canvasHeight, rotationAngle);

    STATE.capturedPhoto = canvas.toDataURL('image/jpeg', 0.85);

    document.getElementById('previewImg').src = STATE.capturedPhoto;
    document.getElementById('photoPreview').classList.add('active');
    document.getElementById('photoActions').classList.add('active');

    // Photo captured → reveal the attendance punch button
    if (typeof showPunchButton === 'function') showPunchButton();
}

function addPhotoOverlay(ctx, w, h, rotationAngle = 0) {
    const overlayHeight = Math.min(100, h * 0.12);
    const padding = 12;
    const lineGap = overlayHeight * 0.22;

    const user = STATE.currentUser ? `ID: ${STATE.currentUser.id} — ${STATE.currentUser.name}` : '';
    const gps  = STATE.currentPosition
        ? `GPS: ${STATE.currentPosition.latitude.toFixed(4)}, ${STATE.currentPosition.longitude.toFixed(4)}`
        : 'GPS unavailable';
    const loc  = STATE.currentLocationName || 'Location detecting...';
    const ts   = formatTimestampIST(new Date());

    ctx.save();

    switch (rotationAngle) {
        case 0:
            // Portrait — overlay at bottom
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillRect(0, h - overlayHeight, w, overlayHeight);
            ctx.fillStyle = 'white';
            ctx.textAlign = 'left';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(user, padding, h - overlayHeight + lineGap + 4);
            ctx.fillStyle = '#ffeb3b';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(loc, padding, h - overlayHeight + lineGap * 2 + 4);
            ctx.fillStyle = 'white';
            ctx.font = '12px sans-serif';
            ctx.fillText(gps, padding, h - overlayHeight + lineGap * 3 + 4);
            ctx.textAlign = 'right';
            ctx.fillText(ts, w - padding, h - overlayHeight + lineGap * 3 + 4);
            break;

        case 90:
            // Landscape right (90°) — overlay at bottom (right side of original)
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillRect(0, h - overlayHeight, w, overlayHeight);
            ctx.fillStyle = 'white';
            ctx.textAlign = 'left';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(user, padding, h - overlayHeight + lineGap + 4);
            ctx.fillStyle = '#ffeb3b';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(loc, padding, h - overlayHeight + lineGap * 2 + 4);
            ctx.fillStyle = 'white';
            ctx.font = '11px sans-serif';
            ctx.fillText(gps, padding, h - overlayHeight + lineGap * 3 + 4);
            ctx.textAlign = 'right';
            ctx.fillText(ts, w - padding, h - overlayHeight + lineGap * 3 + 4);
            break;

        case 180:
            // Portrait upside down — overlay at top
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillRect(0, 0, w, overlayHeight);
            ctx.fillStyle = 'white';
            ctx.textAlign = 'left';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(user, padding, overlayHeight - lineGap * 2.5);
            ctx.fillStyle = '#ffeb3b';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(loc, padding, overlayHeight - lineGap * 1.5);
            ctx.fillStyle = 'white';
            ctx.font = '12px sans-serif';
            ctx.fillText(gps, padding, overlayHeight - lineGap * 0.5);
            ctx.textAlign = 'right';
            ctx.fillText(ts, w - padding, overlayHeight - lineGap * 0.5);
            break;

        case 270:
            // Landscape left (270°) — overlay at bottom
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillRect(0, h - overlayHeight, w, overlayHeight);
            ctx.fillStyle = 'white';
            ctx.textAlign = 'left';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(user, padding, h - overlayHeight + lineGap + 4);
            ctx.fillStyle = '#ffeb3b';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(loc, padding, h - overlayHeight + lineGap * 2 + 4);
            ctx.fillStyle = 'white';
            ctx.font = '11px sans-serif';
            ctx.fillText(gps, padding, h - overlayHeight + lineGap * 3 + 4);
            ctx.textAlign = 'right';
            ctx.fillText(ts, w - padding, h - overlayHeight + lineGap * 3 + 4);
            break;
    }

    ctx.restore();
}

function confirmPhoto() {
    document.getElementById('photoPreview').classList.remove('active');
    document.getElementById('photoActions').classList.remove('active');
    document.getElementById('formSection').classList.add('active');
}

function retakePhoto() {
    STATE.capturedPhoto = null;
    document.getElementById('previewImg').src = '';
    document.getElementById('photoPreview').classList.remove('active');
    document.getElementById('photoActions').classList.remove('active');
    document.getElementById('formSection').classList.remove('active');
    // Punch button stays visible — attendance is independent of retake
}
