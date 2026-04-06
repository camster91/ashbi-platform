import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import {
  Sparkles,
  CheckCircle,
  FileSignature,
  Loader2,
  Eraser,
  PenTool,
  Keyboard,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDate } from '../lib/utils';

function SignatureCanvas({ onSignatureChange }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const startDrawing = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  }, [getCoords]);

  const draw = useCallback((e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }, [isDrawing, getCoords]);

  const stopDrawing = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      const canvas = canvasRef.current;
      onSignatureChange(hasDrawn ? canvas.toDataURL('image/png') : null);
    }
  }, [isDrawing, hasDrawn, onSignatureChange]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onSignatureChange(null);
  }, [onSignatureChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  return (
    <div>
      <div className="relative border-2 border-dashed border-slate-300 rounded-lg bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="w-full h-40 cursor-crosshair touch-none"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-300 text-sm">Draw your signature here</p>
          </div>
        )}
      </div>
      {hasDrawn && (
        <button
          type="button"
          onClick={clear}
          className="mt-2 text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 transition-colors"
        >
          <Eraser className="w-3 h-3" />
          Clear signature
        </button>
      )}
    </div>
  );
}

export default function PortalContract() {
  const { token } = useParams();
  const [signerName, setSignerName] = useState('');
  const [signatureMode, setSignatureMode] = useState('draw'); // 'draw' | 'type'
  const [signatureData, setSignatureData] = useState(null);
  const [signed, setSigned] = useState(false);

  const { data: contract, isLoading, error } = useQuery({
    queryKey: ['portal-contract', token],
    queryFn: () => api.getPortalContract(token),
    retry: false,
  });

  const signMutation = useMutation({
    mutationFn: (data) => api.signPortalContract(token, data),
    onSuccess: () => {
      setSigned(true);
    },
  });

  const handleSign = () => {
    if (!signerName.trim()) return;
    const payload = {
      signerName: signerName.trim(),
      signatureType: signatureMode,
    };
    if (signatureMode === 'draw' && signatureData) {
      payload.signatureImage = signatureData;
    }
    signMutation.mutate(payload);
  };

  const canSign = signerName.trim() && (signatureMode === 'type' || signatureData);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <FileSignature className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Contract Not Found</h1>
          <p className="text-slate-500">This link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  const alreadySigned = contract.status === 'SIGNED' || contract.signedAt;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <span className="text-sm font-medium text-slate-500">Ashbi Design</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mt-3">Contract</h1>
          {contract.title && (
            <p className="text-slate-500 mt-1">{contract.title}</p>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Signed confirmation */}
        {(signed || alreadySigned) && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-green-800 mb-1">Contract Signed</h2>
            <p className="text-green-600">
              {contract.signedAt
                ? `Signed on ${formatDate(contract.signedAt)}`
                : `Signed on ${formatDate(new Date())}`
              }
            </p>
            {(contract.signerName || signerName) && (
              <p className="text-green-600 text-sm mt-1">
                by {contract.signerName || signerName}
              </p>
            )}
          </div>
        )}

        {/* Contract Content */}
        <div className="bg-white rounded-xl border border-slate-200 p-8">
          {contract.clientName && (
            <p className="text-sm text-slate-500 mb-4">
              Prepared for: <span className="font-medium text-slate-700">{contract.clientName}</span>
            </p>
          )}
          <div
            className="prose prose-slate max-w-none prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-p:text-slate-600 prose-li:text-slate-600"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(contract.content || contract.htmlContent || '', {
                ALLOWED_TAGS: [
                  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
                  'ul', 'ol', 'li', 'strong', 'em', 'u', 'a', 'blockquote',
                  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span',
                ],
                ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
              }),
            }}
          />
        </div>

        {/* Signature Area */}
        {!signed && !alreadySigned && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Sign This Contract</h3>

            {/* Name input */}
            <div>
              <label htmlFor="signer-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                Full Legal Name
              </label>
              <input
                id="signer-name"
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            {/* Signature mode toggle */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Signature</label>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setSignatureMode('draw')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                    signatureMode === 'draw'
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  )}
                >
                  <PenTool className="w-3 h-3" />
                  Draw
                </button>
                <button
                  type="button"
                  onClick={() => setSignatureMode('type')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                    signatureMode === 'type'
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  )}
                >
                  <Keyboard className="w-3 h-3" />
                  Type
                </button>
              </div>

              {signatureMode === 'draw' ? (
                <SignatureCanvas onSignatureChange={setSignatureData} />
              ) : (
                <div className="border-2 border-dashed border-slate-300 rounded-lg bg-white p-6 text-center">
                  {signerName.trim() ? (
                    <p className="text-3xl font-signature text-slate-800" style={{ fontFamily: "'Caveat', cursive, serif" }}>
                      {signerName}
                    </p>
                  ) : (
                    <p className="text-slate-300 text-sm">Your name will appear here as a typed signature</p>
                  )}
                </div>
              )}
            </div>

            {/* Sign button */}
            <button
              onClick={handleSign}
              disabled={!canSign || signMutation.isPending}
              className="w-full px-6 py-3 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              {signMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <FileSignature className="w-4 h-4" />
              Sign Contract
            </button>

            {signMutation.isError && (
              <p className="text-sm text-red-600 text-center">Something went wrong. Please try again.</p>
            )}

            <p className="text-xs text-slate-400 text-center">
              By signing, you agree to the terms outlined in this contract. This constitutes a legally binding electronic signature.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-slate-400">Powered by Ashbi Design</p>
        </div>
      </main>
    </div>
  );
}
