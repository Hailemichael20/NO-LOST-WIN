import React, { useState } from 'react';
import { db } from './firebase'; // Adjust path if firebase.js is in another folder
import { collection, addDoc } from 'firebase/firestore';

// --- YOUR EXISTING FUNCTION (WITH YOUR UPDATED DETAILS) ---
const uploadReceipt = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", "play-win-receipt"); // <--- Updated preset name

  // <--- Replace YOUR_CLOUD_NAME with your actual Cloudinary cloud name below
  const response = await fetch("https://api.cloudinary.com/v1_1/YOUR_CLOUD_NAME/image/upload", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();

  // Return the image URL to store in Firestore
  return data.secure_url;
};

// --- COMPONENT THAT USES THE FUNCTION ABOVE ---
export default function UploadReceipt() {
  const [loading, setLoading] = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);

    try {
      // 1. Upload to Cloudinary using your function
      const imageUrl = await uploadReceipt(file);

      if (!imageUrl) {
        throw new Error("Failed to get image URL from Cloudinary.");
      }

      // 2. Save the URL to Firestore
      await addDoc(collection(db, "orders"), {
        receiptUrl: imageUrl,
        createdAt: new Date(),
      });

      alert("Receipt uploaded and saved successfully!");
    } catch (error) {
      console.error("Error uploading receipt:", error);
      alert("Upload failed! Check the browser console for details.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h3>Upload Receipt</h3>
      <input 
        type="file" 
        accept="image/*" 
        onChange={handleFileChange} 
        disabled={loading} 
      />
      {loading && <p>Uploading receipt...</p>}
    </div>
  );
}