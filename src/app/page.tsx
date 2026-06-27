'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  Image as ImageIcon, 
  Search, 
  UploadCloud, 
  Clock, 
  Stamp, 
  ChevronRight, 
  Edit3, 
  Loader2, 
  ArrowLeft,
  CheckCircle,
  Download,
  Trash2,
  ListFilter
} from 'lucide-react';

interface ImageRecord {
  id: number;
  filename: string;
  original_path: string;
  edited_path: string | null;
  prompt: string;
  status: 'pending' | 'analyzed' | 'completed' | 'failed';
  created_at: string;
}

interface ProcessingItem {
  name: string;
  file: File;
  status: 'queued' | 'uploading' | 'scanning' | 'ready' | 'retouching' | 'completed' | 'failed';
  id?: number;
}

// BEFORE/AFTER COMPARISON SLIDER COMPONENT
function ImageSlider({ before, after }: { before: string; after: string }) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    let position = (x / rect.width) * 100;
    if (position < 0) position = 0;
    if (position > 100) position = 100;
    setSliderPosition(position);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging && e.buttons !== 1) return;
    handleMove(e.clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      handleMove(e.touches[0].clientX);
    }
  };

  return (
    <div 
      ref={containerRef}
      className="comparison-container"
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onMouseDown={() => setIsDragging(true)}
      onMouseUp={() => setIsDragging(false)}
      onMouseLeave={() => setIsDragging(false)}
    >
      <img src={after} alt="Cleaned" className="comparison-image comparison-after" />
      <div 
        className="comparison-before"
        style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          width: '100%', 
          height: '100%', 
          clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` 
        }}
      >
        <img src={before} alt="Original" className="comparison-image" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
      <div 
        className="comparison-slider" 
        style={{ left: `${sliderPosition}%` }}
      >
        <div className="comparison-handle">
          <span style={{ fontSize: '10px', color: 'var(--color-primary)' }}>◀▶</span>
        </div>
      </div>
      <span className="comparison-label label-before">Before (Original)</span>
      <span className="comparison-label label-after">After (Retouched)</span>
    </div>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'upload' | 'history' | 'watermark'>('upload');
  const [history, setHistory] = useState<ImageRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<ImageRecord | null>(null);
  
  const [isUploading, setIsUploading] = useState(false);
  const [isRetouching, setIsRetouching] = useState(false);
  const [editablePrompt, setEditablePrompt] = useState('');
  
  const [uploadQueue, setUploadQueue] = useState<File[]>([]);
  const [processingList, setProcessingList] = useState<ProcessingItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load history from DB
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      if (data.records) {
        setHistory(data.records);
        // Refresh selected record if open
        if (selectedRecord) {
          const updated = data.records.find((r: ImageRecord) => r.id === selectedRecord.id);
          if (updated) {
            setSelectedRecord(updated);
            setEditablePrompt(updated.prompt);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const filesArray = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
      setUploadQueue(prev => [...prev, ...filesArray]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      setUploadQueue(prev => [...prev, ...filesArray]);
    }
  };

  // Perform Bulk Upload AND Automatic Prompt Scanning & Retouching
  const startUploadAndAnalyze = async () => {
    if (uploadQueue.length === 0) return;
    setIsUploading(true);

    const itemsToProcess = uploadQueue.map(file => ({
      name: file.name,
      file,
      status: 'queued' as const
    }));
    
    setProcessingList(itemsToProcess);

    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];
      
      // Update UI: uploading...
      setProcessingList(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'uploading' } : p));
      
      try {
        const formData = new FormData();
        formData.append('file', item.file);
        
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        
        if (!uploadRes.ok) throw new Error('Upload failed');
        const uploadData = await uploadRes.json();
        const record = uploadData.record as ImageRecord;

        // Update UI: scanning prompt (analyzing with Gemini)...
        setProcessingList(prev => prev.map((p, idx) => idx === i ? { ...p, id: record.id, status: 'scanning' } : p));

        // Call Gemini automatic prompt analysis
        const analyzeRes = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: record.id })
        });
        
        if (!analyzeRes.ok) throw new Error('Gemini prompt generation failed');
        const analyzeData = await analyzeRes.json();
        const analyzedRecord = analyzeData.record as ImageRecord;

        // Update UI: ready
        setProcessingList(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'ready' } : p));
      } catch (err) {
        console.error('Processing error:', err);
        setProcessingList(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'failed' } : p));
      }
    }

    setUploadQueue([]);
    setIsUploading(false);
    await fetchHistory();
  };

  // Trigger Inpainting Image Retouching
  const handleRetouch = async () => {
    if (!selectedRecord) return;
    setIsRetouching(true);
    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedRecord.id, prompt: editablePrompt })
      });
      const data = await res.json();
      if (data.record) {
        setSelectedRecord(data.record);
        await fetchHistory();
      } else {
        throw new Error(data.error || 'Failed to edit image');
      }
    } catch (err) {
      alert('Retouching failed: ' + (err as Error).message);
    } finally {
      setIsRetouching(false);
    }
  };

  const selectRecordAndOpen = (id: number) => {
    const record = history.find(r => r.id === id);
    if (record) {
      setSelectedRecord(record);
      setEditablePrompt(record.prompt);
      setActiveTab('history');
    }
  };

  const filteredHistory = history.filter(item => 
    item.filename.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.prompt.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="app-container">
      {/* SIDEBAR NAVIGATION */}
      <aside style={{
        position: 'fixed', top: 0, left: 0, bottom: 0,
        width: 'var(--sidebar-width)', backgroundColor: '#FFFFFF',
        borderRight: '1px solid var(--color-border)', display: 'flex',
        flexDirection: 'column', zIndex: 100
      }}>
        {/* Sidebar Header */}
        <div style={{
          height: 'var(--header-height)', display: 'flex',
          alignItems: 'center', gap: '8px', padding: '0 24px',
          borderBottom: '1px solid var(--color-border)'
        }}>
          <div className="logo-badge">SJ</div>
          <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--color-text)' }}>Shreeva jewells</span>
        </div>

        {/* Sidebar Navigation */}
        <nav style={{ flexGrow: 1, padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          
          {/* Edit Image Tab */}
          <button 
            onClick={() => { setActiveTab('upload'); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
              padding: '12px 16px', borderRadius: 'var(--radius-sm)', border: 'none',
              background: activeTab === 'upload' ? 'var(--color-primary-light)' : 'transparent',
              color: activeTab === 'upload' ? 'var(--color-primary)' : 'var(--color-text)',
              cursor: 'pointer', fontWeight: activeTab === 'upload' ? '600' : '400',
              textAlign: 'left', transition: 'all var(--transition-fast)'
            }}
          >
            <UploadCloud size={20} style={{ color: activeTab === 'upload' ? 'var(--color-primary)' : 'var(--color-text-muted)' }} />
            <span style={{ fontSize: '14px' }}>Edit Image (Upload)</span>
          </button>

          {/* History tab */}
          <button 
            onClick={() => { setActiveTab('history'); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
              padding: '12px 16px', borderRadius: 'var(--radius-sm)', border: 'none',
              background: activeTab === 'history' ? 'var(--color-primary-light)' : 'transparent',
              color: activeTab === 'history' ? 'var(--color-primary)' : 'var(--color-text)',
              cursor: 'pointer', fontWeight: activeTab === 'history' ? '600' : '400',
              textAlign: 'left', transition: 'all var(--transition-fast)'
            }}
          >
            <Clock size={20} style={{ color: activeTab === 'history' ? 'var(--color-primary)' : 'var(--color-text-muted)' }} />
            <span style={{ fontSize: '14px' }}>History & Logs</span>
          </button>

          {/* Add Watermark Tab */}
          <button 
            onClick={() => setActiveTab('watermark')}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
              padding: '12px 16px', borderRadius: 'var(--radius-sm)', border: 'none',
              background: activeTab === 'watermark' ? 'var(--color-primary-light)' : 'transparent',
              color: activeTab === 'watermark' ? 'var(--color-primary)' : 'var(--color-text)',
              cursor: 'pointer', fontWeight: activeTab === 'watermark' ? '600' : '400',
              textAlign: 'left', transition: 'all var(--transition-fast)'
            }}
          >
            <Stamp size={20} style={{ color: activeTab === 'watermark' ? 'var(--color-primary)' : 'var(--color-text-muted)' }} />
            <span style={{ fontSize: '14px', flexGrow: 1 }}>Add Watermark</span>
            <span style={{
              fontSize: '9px', fontWeight: '600', backgroundColor: '#e2e8f0',
              color: 'var(--color-text-muted)', padding: '2px 6px', borderRadius: '10px'
            }}>Soon</span>
          </button>
        </nav>
        
        {/* Sidebar Footer */}
        <div style={{ padding: '20px 24px', borderTop: '1px solid var(--color-border)', fontSize: '12px', color: 'var(--color-text-muted)' }}>
          © Shreeva Jewells AI v1.0
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <main className="main-content">
        {/* Top Header Row */}
        <div style={{
          height: 'var(--header-height)', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '30px', borderBottom: '1px solid var(--color-border)',
          paddingBottom: '15px'
        }}>
          {/* Search Box */}
          <div style={{ position: 'relative', width: '320px' }}>
            <Search size={18} style={{
              position: 'absolute', left: '14px', top: '50%',
              transform: 'translateY(-50%)', color: 'var(--color-text-muted)'
            }} />
            <input 
              type="text" 
              placeholder="Search images or prompts..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px 10px 42px',
                border: 'none', borderRadius: '24px', backgroundColor: '#f1f5f9',
                outline: 'none', fontSize: '13px'
              }} 
            />
          </div>

          {/* User profile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--color-text)' }}>admin</div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Administrator</div>
            </div>
            <div style={{
              width: '38px', height: '38px', borderRadius: '50%',
              backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: '600', fontSize: '14px'
            }}>
              DL
            </div>
          </div>
        </div>

        {/* TAB CONTROLS */}
        {activeTab === 'watermark' && (
          /* WATERMARK SECTION - COMING SOON */
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: '60vh', textAlign: 'center'
          }}>
            <Stamp size={80} style={{ color: 'var(--color-primary)', marginBottom: '20px', opacity: 0.8 }} />
            <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>Watermark Feature is Coming Soon</h2>
            <p style={{ color: 'var(--color-text-muted)', maxWidth: '400px', fontSize: '14px' }}>
              We are working on a precise watermarking tool that automatically positions your brand logo onto finished photos without covering the jewelry itself.
            </p>
          </div>
        )}

        {activeTab === 'upload' && (
          /* EDIT IMAGE TAB - CORE UPLOAD AND BATCH QUEUE AREA */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--color-text)', marginBottom: '4px' }}>Edit Jewelry Images</h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
                Upload your jewelry ring photos. Our system will **automatically run Gemini** to scan for dust, scratches, and hands, generating optimized cleaning instructions immediately.
              </p>
            </div>

            {/* Dropzone */}
            <div 
              className="upload-dropzone"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud size={48} style={{ color: 'var(--color-primary)', opacity: 0.8 }} />
              <div>
                <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px' }}>Drag and drop jewelry images here</h4>
                <p style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Supports JPG, JPEG, and PNG files</p>
              </div>
              <button className="btn btn-secondary btn-sm" style={{ pointerEvents: 'none' }}>
                Select Files
              </button>
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                multiple
                accept="image/*"
              />
            </div>

            {/* Upload Queue Queue list */}
            {uploadQueue.length > 0 && (
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <h4 style={{ fontSize: '15px', fontWeight: '600' }}>Selected Queue ({uploadQueue.length} files)</h4>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => setUploadQueue([])}
                      className="btn btn-outline btn-sm"
                      disabled={isUploading}
                    >
                      Clear Queue
                    </button>
                    <button 
                      onClick={startUploadAndAnalyze}
                      className="btn btn-primary btn-sm"
                      disabled={isUploading}
                    >
                      {isUploading ? (
                        <>
                          <Loader2 size={12} className="animate-spin" /> Uploading & Processing...
                        </>
                      ) : 'Start Processing'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '16px' }}>
                  {uploadQueue.map((file, idx) => (
                    <div 
                      key={idx}
                      style={{
                        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden', backgroundColor: 'var(--color-bg)', position: 'relative'
                      }}
                    >
                      <div style={{ aspectRatio: '1/1', overflow: 'hidden' }}>
                        <img 
                          src={URL.createObjectURL(file)} 
                          alt={file.name} 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                        />
                      </div>
                      <div style={{
                        padding: '8px', fontSize: '11px', fontWeight: '500',
                        color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        {file.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live processing list (after user hits start) */}
            {processingList.length > 0 && (
              <div className="card">
                <h4 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '16px' }}>Processing Batch Results</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {processingList.map((item, idx) => (
                    <div 
                      key={idx}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)', backgroundColor: '#fcfcfc'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexGrow: 1 }}>
                        <div style={{
                          width: '42px', height: '42px', borderRadius: '6px',
                          overflow: 'hidden', backgroundColor: '#e2e8f0', flexShrink: 0
                        }}>
                          <img 
                            src={URL.createObjectURL(item.file)} 
                            alt={item.name} 
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '600' }}>{item.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                            {item.status === 'queued' && 'Queued...'}
                            {item.status === 'uploading' && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <Loader2 size={10} className="animate-spin" /> Uploading image file...
                              </span>
                            )}
                            {item.status === 'scanning' && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--color-warning)' }}>
                                <Loader2 size={10} className="animate-spin" /> Scanning with Gemini AI & creating prompt...
                              </span>
                            )}
                            {item.status === 'ready' && (
                              <span style={{ color: 'var(--color-warning)', fontWeight: '500' }}>
                                ✓ Prompt generated! Preparing retouching...
                              </span>
                            )}
                            {item.status === 'retouching' && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--color-primary)' }}>
                                <Loader2 size={10} className="animate-spin" /> Running AI Image Retouching...
                              </span>
                            )}
                            {item.status === 'completed' && (
                              <span style={{ color: 'var(--color-success)', fontWeight: '500' }}>
                                ✓ Retouching completed successfully! Ready.
                              </span>
                            )}
                            {item.status === 'failed' && (
                              <span style={{ color: 'var(--color-danger)' }}>
                                ✗ Processing failed. Please check billing or try again.
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {item.id && (item.status === 'ready' || item.status === 'completed') && (
                        <button 
                          onClick={() => selectRecordAndOpen(item.id!)}
                          className="btn btn-secondary btn-sm"
                        >
                          {item.status === 'completed' ? 'View & Download' : 'View Prompt'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          /* HISTORY SECTION - SIDEBAR LIST & MAIN WORKPLACE VIEWPORT */
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '30px' }}>
            
            {/* Scrollable list panel */}
            <div>
              <div className="card" style={{ padding: '20px', height: 'calc(100vh - 180px)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <Clock size={16} style={{ color: 'var(--color-text-muted)' }} />
                  <h3 style={{ fontSize: '15px', fontWeight: '600' }}>Historical Logs ({filteredHistory.length})</h3>
                </div>
                
                <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {filteredHistory.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--color-text-muted)', fontSize: '12px' }}>
                      {searchQuery ? 'No matching logs found.' : 'No images processed yet.'}
                    </div>
                  ) : (
                    filteredHistory.map((item) => (
                      <div 
                        key={item.id}
                        className={`history-item ${selectedRecord?.id === item.id ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedRecord(item);
                          setEditablePrompt(item.prompt);
                        }}
                      >
                        <div style={{
                          width: '42px', height: '42px', borderRadius: '6px',
                          backgroundColor: '#f1f5f9', overflow: 'hidden', flexShrink: 0
                        }}>
                          <img 
                            src={item.original_path} 
                            alt="preview" 
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                          />
                        </div>
                        <div style={{ flexGrow: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: '13px', fontWeight: '500', color: 'var(--color-text)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                          }}>
                            {item.filename}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                            <span style={{
                              fontSize: '10px', fontWeight: '500', textTransform: 'capitalize',
                              color: item.status === 'completed' ? 'var(--color-success)' :
                                     item.status === 'analyzed' ? 'var(--color-warning)' : 'var(--color-text-muted)'
                            }}>
                              {item.status}
                            </span>
                          </div>
                        </div>
                        <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Details & editing screen */}
            <div>
              {selectedRecord ? (
                <div className="card" style={{ minHeight: 'calc(100vh - 180px)' }}>
                  
                  {/* Actions Header Row */}
                  <div style={{ 
                    display: 'flex', alignItems: 'center', gap: '12px', 
                    marginBottom: '24px', borderBottom: '1px solid var(--color-border)', 
                    paddingBottom: '15px' 
                  }}>
                    <div style={{ flexGrow: 1 }}>
                      <h2 style={{ fontSize: '18px', fontWeight: '600' }}>{selectedRecord.filename}</h2>
                      <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        Status: <strong style={{ textTransform: 'capitalize' }}>{selectedRecord.status}</strong>
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      {/* Download Button */}
                      {selectedRecord.status === 'completed' && selectedRecord.edited_path && (
                        <a 
                          href={selectedRecord.edited_path} 
                          download={selectedRecord.filename}
                          className="btn btn-secondary btn-sm"
                          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          <Download size={14} /> Download Retouched
                        </a>
                      )}

                      {/* Run AI Button */}
                      {(selectedRecord.status === 'analyzed' || selectedRecord.status === 'completed') && (
                        <button 
                          onClick={handleRetouch}
                          disabled={isRetouching}
                          className="btn btn-primary btn-sm"
                        >
                          {isRetouching ? (
                            <>
                              <Loader2 size={14} className="animate-spin" /> Retouching...
                            </>
                          ) : (
                            <>
                              <Sparkles size={14} /> Run Retouching
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Splitscreen Preview & Prompt info */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                    
                    {/* Visual Comparison slider */}
                    <div>
                      <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--color-text-muted)' }}>IMAGE PREVIEW & COMPARISON</h4>
                      
                      {selectedRecord.status === 'completed' && selectedRecord.edited_path ? (
                        <ImageSlider 
                          before={selectedRecord.original_path} 
                          after={selectedRecord.edited_path} 
                        />
                      ) : (
                        <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border)', backgroundColor: '#f1f5f9' }}>
                          <img 
                            src={selectedRecord.original_path} 
                            alt="Original preview" 
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                          />
                          {isRetouching && (
                            <div style={{
                              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                              backgroundColor: 'rgba(255,255,255,0.75)', display: 'flex', flexDirection: 'column',
                              alignItems: 'center', justifyContent: 'center', gap: '12px'
                            }}>
                              <Loader2 size={36} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                              <span style={{ fontSize: '13px', fontWeight: '600' }}>
                                Retouching image... (Cleaning scratches, dust and hair)
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Prompt Customization panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div className="form-group">
                        <label className="form-label">Retouching Instructions (Custom Prompt)</label>
                        <textarea 
                          className="form-control"
                          rows={14}
                          value={editablePrompt}
                          onChange={(e) => setEditablePrompt(e.target.value)}
                          disabled={isRetouching}
                          placeholder="Describe the jewelry materials, shape, and imperfections to remove..."
                        />
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                          💡 You can modify this text to add custom rules before clicking "Run Retouching".
                        </span>
                      </div>

                      {/* Details Box */}
                      <div style={{
                        padding: '16px', border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)', backgroundColor: '#fcfcfc',
                        display: 'flex', gap: '12px'
                      }}>
                        <CheckCircle size={18} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                        <div style={{ fontSize: '12px', lineHeight: '1.5' }}>
                          <strong style={{ display: 'block', marginBottom: '2px' }}>AI Preservation Policy Active</strong>
                          This prompt instructs the AI to preserve the metal color, reflections, gemstone details, and backgrounds. Image sizing and resolution will remain exactly identical.
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              ) : (
                <div style={{ 
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', minHeight: '60vh', textAlign: 'center'
                }}>
                  <Clock size={80} style={{ color: 'var(--color-primary)', marginBottom: '20px', opacity: 0.6 }} />
                  <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px' }}>No Log Selected</h2>
                  <p style={{ color: 'var(--color-text-muted)', maxWidth: '400px', fontSize: '14px' }}>
                    Select a previous job from the sidebar log on the left to inspect prompts, compare before/after images, and download clean files.
                  </p>
                </div>
              )}
            </div>

          </div>
        )}
      </main>
      
      {/* GLOBAL CSS LOADER STYLE */}
      <style jsx global>{`
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
