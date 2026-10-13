'use client'

import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, RefreshCw, Upload, Download, WandSparkles, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { googleFlowApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface FlowOptions {
  models: string[]
  aspectRatios: string[]
  defaultModel?: string
  defaultAspectRatio?: string
}

interface GeneratedImage {
  image: string
  mimeType: string
  path: string
}

const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024

export default function GoogleFlowPage() {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [options, setOptions] = useState<FlowOptions | null>(null)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [aspectRatio, setAspectRatio] = useState('')
  const [referenceImage, setReferenceImage] = useState<File | null>(null)
  const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const refreshOptions = async () => {
    setOptionsLoading(true)
    setError('')
    try {
      const response = await googleFlowApi.getOptions()
      const nextOptions = response.options as FlowOptions
      setOptions(nextOptions)
      setModel((current) => (
        nextOptions.models.includes(current)
          ? current
          : nextOptions.defaultModel || nextOptions.models[0] || ''
      ))
      setAspectRatio((current) => (
        nextOptions.aspectRatios.includes(current)
          ? current
          : nextOptions.defaultAspectRatio || nextOptions.aspectRatios[0] || ''
      ))
    } catch (requestError: any) {
      const message = requestError.message || 'Could not load Google Flow options.'
      setError(message)
      toast.error(message)
    } finally {
      setOptionsLoading(false)
    }
  }

  useEffect(() => {
    if (user?.role === 'admin') refreshOptions()
  }, [user?.role])

  const chooseReference = (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('Choose a PNG, JPEG, or WebP image.')
      return
    }
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
      toast.error('Reference image must be 20 MB or smaller.')
      return
    }
    setReferenceImage(file)
  }

  const generate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!prompt.trim() || generating) return
    if (!options?.models.includes(model) || !options.aspectRatios.includes(aspectRatio)) {
      toast.error('Refresh Flow options and choose an available model and aspect ratio.')
      return
    }

    setGenerating(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('prompt', prompt.trim())
      formData.append('model', model)
      formData.append('aspectRatio', aspectRatio)
      if (referenceImage) formData.append('referenceImage', referenceImage)
      const response = await googleFlowApi.generate(formData)
      setGeneratedImage(response)
      toast.success('Image generated with Google Flow.')
    } catch (requestError: any) {
      const message = requestError.message || 'Google Flow image generation failed.'
      setError(message)
      toast.error(message)
    } finally {
      setGenerating(false)
    }
  }

  if (user?.role !== 'admin') {
    return (
      <div className="p-6">
        <div className="glass rounded-2xl p-6 max-w-xl">
          <h1 className="text-xl font-bold text-white">Google Flow is admin-only</h1>
          <p className="text-sm text-dark-300 mt-2">This website uses the administrator&apos;s connected Google Flow account and credits.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center">
            <ImageIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Google Flow Studio</h1>
            <p className="text-sm text-dark-300">Generate and edit images with your connected Flow account.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refreshOptions}
          disabled={optionsLoading || generating}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${optionsLoading ? 'animate-spin' : ''}`} />
          Sync Flow options
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)] gap-6 items-start">
        <form onSubmit={generate} className="glass rounded-2xl p-5 md:p-6 space-y-5">
          <div>
            <label htmlFor="flow-prompt" className="block text-sm font-medium text-white mb-2">Prompt</label>
            <textarea
              id="flow-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={4000}
              required
              rows={5}
              placeholder="Describe the image you want to create..."
              className="input-dark w-full resize-y min-h-32"
            />
            <p className="text-xs text-dark-500 text-right mt-1">{prompt.length}/4000</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="flow-model" className="block text-sm font-medium text-white mb-2">Flow model</label>
              <select
                id="flow-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={!options || optionsLoading || generating}
                className="input-dark w-full"
              >
                {!options?.models.length && <option value="">Sync options first</option>}
                {options?.models.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="flow-ratio" className="block text-sm font-medium text-white mb-2">Aspect ratio</label>
              <select
                id="flow-ratio"
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value)}
                disabled={!options || optionsLoading || generating}
                className="input-dark w-full"
              >
                {!options?.aspectRatios.length && <option value="">Sync options first</option>}
                {options?.aspectRatios.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => chooseReference(event.target.files?.[0])}
            />
            {referenceImage ? (
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <ImageIcon className="w-5 h-5 text-pink-300" />
                <span className="text-sm text-white truncate flex-1">{referenceImage.name}</span>
                <button
                  type="button"
                  onClick={() => { setReferenceImage(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  className="p-1 text-dark-300 hover:text-white"
                  aria-label="Remove reference image"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl border border-dashed border-white/15 px-4 py-4 text-sm text-dark-300 hover:border-pink-400/50 hover:text-white transition-colors flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Attach a reference image for editing (optional)
              </button>
            )}
            <p className="text-xs text-dark-500 mt-2">PNG, JPEG, or WebP, up to 20 MB.</p>
          </div>

          <button
            type="submit"
            disabled={generating || optionsLoading || !options || !prompt.trim()}
            className="btn-primary w-full justify-center py-3"
          >
            {generating
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating in Flow...</>
              : <><WandSparkles className="w-4 h-4" /> Generate image</>}
          </button>
          <p className="text-xs text-dark-500 text-center">
            This studio sends requests directly to Google Flow. It does not use the website’s Nano Banana 2.1 or Agnes fallback chain.
          </p>
        </form>

        <section className="glass rounded-2xl p-5 md:p-6 min-h-80">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-white">Result</h2>
            {generatedImage && (
              <a
                href={`data:${generatedImage.mimeType};base64,${generatedImage.image}`}
                download={`google-flow-${Date.now()}.${generatedImage.mimeType === 'image/jpeg' ? 'jpg' : generatedImage.mimeType.split('/')[1]}`}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Download className="w-4 h-4" /> Download
              </a>
            )}
          </div>
          {generatedImage ? (
            <img
              src={`data:${generatedImage.mimeType};base64,${generatedImage.image}`}
              alt={prompt || 'Google Flow generated image'}
              className="w-full rounded-xl"
            />
          ) : (
            <div className="min-h-64 rounded-xl border border-dashed border-white/10 flex flex-col items-center justify-center text-center p-6">
              <ImageIcon className="w-9 h-9 text-dark-500 mb-3" />
              <p className="text-sm text-dark-400">Your generated image will appear here.</p>
              <p className="text-xs text-dark-600 mt-1">Image generation uses your connected Google Flow account.</p>
            </div>
          )}
          {generatedImage && <p className="text-xs text-dark-500 mt-3 break-all">Saved on this server: {generatedImage.path}</p>}
        </section>
      </div>
    </div>
  )
}
