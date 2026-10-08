// A very quiet room, synthesized: filtered noise for air, two low detuned sines for the
// lamp's hum, and small gestures (a key's thock, a page's swish, an ignition) built from
// envelopes. No files, nothing loud, nothing before the reader's first gesture.

export type Ambience = {
  start(): void // after a user gesture; safe to call repeatedly
  setAct(act: number): void
  cue(name: 'key' | 'miss' | 'ignite' | 'hold' | 'complete' | 'page' | 'whoosh' | 'land'): void
  toggle(): boolean // returns the new enabled state
  readonly enabled: boolean
  dispose(): void
}

const MASTER = 0.14

export function createAmbience(): Ambience {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let airFilter: BiquadFilterNode | null = null
  let droneGain: GainNode | null = null
  let droneOscs: OscillatorNode[] = []
  let enabled = true
  let started = false

  function boot() {
    if (ctx) return
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)

    // Air: looping brown noise through a dark lowpass.
    const seconds = 4
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
    const air = ctx.createBufferSource()
    air.buffer = buffer
    air.loop = true
    airFilter = ctx.createBiquadFilter()
    airFilter.type = 'lowpass'
    airFilter.frequency.value = 240
    airFilter.Q.value = 0.4
    const airGain = ctx.createGain()
    airGain.gain.value = 0.5
    air.connect(airFilter).connect(airGain).connect(master)
    air.start()

    // Hum: two sines a wide fifth apart, slightly detuned, barely there.
    droneGain = ctx.createGain()
    droneGain.gain.value = 0.05
    const droneFilter = ctx.createBiquadFilter()
    droneFilter.type = 'lowpass'
    droneFilter.frequency.value = 160
    droneGain.connect(droneFilter).connect(master)
    droneOscs = [55, 82.4, 55.3].map((freq, i) => {
      const osc = ctx!.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      const g = ctx!.createGain()
      g.gain.value = i === 2 ? 0.3 : 1
      osc.connect(g).connect(droneGain!)
      osc.start()
      return osc
    })

    // A slow breath on the air filter.
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.05
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 60
    lfo.connect(lfoGain).connect(airFilter.frequency)
    lfo.start()
  }

  function ramp(param: AudioParam, value: number, seconds: number) {
    if (!ctx) return
    param.cancelScheduledValues(ctx.currentTime)
    param.setTargetAtTime(value, ctx.currentTime, seconds / 3)
  }

  // A short pitched blip through its own envelope.
  function tone(freq: number, time: number, peak: number, type: OscillatorType = 'sine', glide = 0) {
    if (!ctx || !master || !enabled) return
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(freq + glide, 1), ctx.currentTime + time)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, ctx.currentTime)
    g.gain.linearRampToValueAtTime(peak, ctx.currentTime + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + time)
    osc.connect(g).connect(master)
    osc.start()
    osc.stop(ctx.currentTime + time + 0.05)
  }

  // A burst of filtered noise, for paper and air.
  function hiss(time: number, peak: number, from: number, to: number, q = 0.8) {
    if (!ctx || !master || !enabled) return
    const length = Math.ceil(ctx.sampleRate * time)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = q
    filter.frequency.setValueAtTime(from, ctx.currentTime)
    filter.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + time)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, ctx.currentTime)
    g.gain.linearRampToValueAtTime(peak, ctx.currentTime + time * 0.15)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + time)
    src.connect(filter).connect(g).connect(master)
    src.start()
  }

  return {
    start() {
      if (started) {
        void ctx?.resume()
        return
      }
      started = true
      boot()
      void ctx!.resume()
      if (enabled) ramp(master!.gain, MASTER, 3)
    },
    setAct(act) {
      if (!ctx) return
      // The room darkens and settles as the argument lands, and warms again at the desk.
      const air = [240, 300, 200, 180, 220, 320, 260][Math.min(act, 6)]
      const hum = [0.05, 0.05, 0.065, 0.05, 0.045, 0.06, 0.04][Math.min(act, 6)]
      ramp(airFilter!.frequency, air, 2.5)
      ramp(droneGain!.gain, hum, 2.5)
    },
    cue(name) {
      if (!started || !enabled) return
      switch (name) {
        case 'key':
          tone(170 + Math.random() * 30, 0.07, 0.05, 'triangle')
          hiss(0.04, 0.03, 2400, 1400, 1.4)
          break
        case 'miss':
          tone(110, 0.09, 0.03, 'sine')
          break
        case 'ignite':
          hiss(0.7, 0.05, 300, 1800, 0.6)
          tone(220, 0.8, 0.025, 'sine', 110)
          break
        case 'hold':
          tone(96, 0.5, 0.02, 'sine', 24)
          break
        case 'complete':
          tone(392, 0.5, 0.035, 'sine')
          setTimeout(() => tone(523.25, 0.7, 0.03, 'sine'), 90)
          break
        case 'page':
          hiss(0.28, 0.045, 500, 1600, 0.7)
          break
        case 'whoosh':
          hiss(0.9, 0.06, 160, 900, 0.5)
          break
        case 'land':
          tone(300 + Math.random() * 120, 0.05, 0.02, 'sine')
          break
      }
    },
    toggle() {
      enabled = !enabled
      if (master) ramp(master.gain, enabled ? MASTER : 0, 0.8)
      return enabled
    },
    get enabled() {
      return enabled
    },
    dispose() {
      droneOscs.forEach((o) => o.stop())
      void ctx?.close()
      ctx = null
    },
  }
}
