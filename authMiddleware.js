// react-chatbot-backend/authMiddleware.js

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// IMPORTANT: You need to generate a service account key from Firebase
// Go to Project Settings -> Service accounts -> Generate new private key
// Save the downloaded JSON file as 'firebase-service-account.json' in your backend's root directory.

const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');
let firebaseInitialized = false;

try {
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require('./firebase-service-account.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialized successfully');
  } else {
    console.warn('⚠️  Firebase service account file not found. Auth middleware will reject all requests.');
    console.warn('   Create firebase-service-account.json to enable authentication.');
  }
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin:', error.message);
}

async function authMiddleware(req, res, next) {
  if (!firebaseInitialized) {
    return res.status(500).json({ 
      error: 'Authentication not configured. Please set up firebase-service-account.json' 
    });
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided.' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken; // Add the verified user info to the request object
    next(); // Proceed to the next function (the actual route handler)
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return res.status(403).json({ error: 'Unauthorized: Invalid token.' });
  }
}

module.exports = authMiddleware;
