const WaveFile = require('wavefile').WaveFile
const fs = require('fs')
const path = require('path')

/** Westwood Audio Bag Item */
class AudioIDXItem {
  constructor({
    name = new ArrayBuffer(16),
    size = 0,
    sampleRate = 0,
    flags = 0,
    chunkSize = 0,
    samples = new ArrayBuffer(),
  }) {
    this._nameBuff = name
    this._size = size
    this._sampleRate = sampleRate
    this._flags = flags
    this._chunkSize = chunkSize
    this._samples = samples

    let fileName = ''
    let charCode = 0
    const reader = new DataView(name)
    let nameOffset = 0
    do {
      charCode = reader.getUint8(nameOffset)
      if (charCode === 0x00) {
        break
      }
      fileName += String.fromCharCode(charCode)
      nameOffset++
    } while (nameOffset < 0x10)

    this._name = fileName
  }
  /** 文件名Buffer */
  get nameBuffer() {
    return this._nameBuff
  }
  /** 文件名 */
  get name() {
    return this._name
  }
  /** 文件尺寸 */
  get size() {
    return this._size
  }
  /** 采样率 */
  get sampleRate() {
    return this._sampleRate
  }
  /** 标志位 */
  get flags() {
    return this._flags
  }
  /** ChunkSize */
  get chunkSize() {
    return this._chunkSize
  }
  /** 采样 */
  get samples() {
    return this._samples
  }
}

/** Bag 音频导出专用格式 */
class AudioExactType {
  /**
   * @param {string} name 文件名，无扩展名
   * @param {WaveFile} wav WaveFile对象
   */
  constructor(name, wav) {
    this._name = name
    this._wav = wav
  }
  /** 文件名，不包含扩展名 */
  get name() {
    return this._name
  }
  /** WaveFile对象 */
  get wav() {
    return this._wav.toBuffer()
  }
}

/** Westwood Red Alert 2 audio idx & bag file */
class AudioPackage {
  static MAGIC_NUMBER = 0x47414241
  static MAGIC_NUMBER_2 = 0x00000002
  /**
   * Create a AudioPackage Object with idx & bag OR Create a empty one
   * @param {Buffer | undefined} idxBuff IDX索引文件
   * @param {Buffer | undefined} bagBuff BAG音频包
   */
  constructor(idxBuff, bagBuff) {
    // If input empty, creatr new package
    if (!idxBuff && !bagBuff) {
      this._fileCount = 0
      /** @type {AudioIDXItem[]} */
      this._audioIDXItems = new Array(fileCount)
      return
    }

    const idxArrayBuffer = idxBuff.buffer
    const bagArrayBuffer = bagBuff.buffer

    const dataView = new DataView(idxArrayBuffer, 0x00)
    const format = dataView.getUint32(0x00, false)
    const unknown = dataView.getUint32(0x04, true)
    if (
      format !== AudioPackage.MAGIC_NUMBER ||
      unknown !== AudioPackage.MAGIC_NUMBER_2
    ) {
      throw new TypeError('Idx File ERROR!')
    }
    const fileCount = dataView.getUint32(0x08, true) // 文件数量

    this._fileCount = fileCount

    /** @type {AudioIDXItem[]} */
    this._audioIDXItems = new Array(fileCount)
    for (let i = 0; i < fileCount; i++) {
      const nameStart = 0x0c + i * (0x10 + 5 * 0x04)
      const name = idxArrayBuffer.slice(nameStart, nameStart + 0x10)
      const dataReader = new DataView(idxArrayBuffer, nameStart)
      const offset = dataReader.getUint32(0x10, true)
      const size = dataReader.getUint32(0x14, true)
      const sampleRate = dataReader.getUint32(0x18, true)
      const flags = dataReader.getUint32(0x1c, true)
      const chunkSize = dataReader.getUint32(0x20, true)
      const samples = bagArrayBuffer.slice(offset, offset + size)
      this._audioIDXItems[i] = new AudioIDXItem({
        name,
        // offset,
        size,
        sampleRate,
        flags,
        chunkSize,
        samples,
      })
    }
  }
  get fileCount() {
    return this._fileCount
  }
  get audioIDXItems() {
    return this._audioIDXItems
  }
  /**
   * 根据文件名，查找 ID 号码
   * @param {string} fileName 要查找的文件名，自动忽略扩展名
   */
  _getIDByName(fileName) {
    const name = path
      .basename(fileName, path.extname(fileName))
      .substring(0, 15)
    for (let index = 0; index < this.fileCount; index++) {
      const itemToCheck = this.audioIDXItems[index]
      if (itemToCheck.name === name) {
        return index
      }
    }
    return -1
  }
  /**
   * 根据索引 ID，导出单个音频
   * @param {number} id 索引ID
   * @returns {AudioExactType}
   */
  exactByID(id = -1) {
    if (id < 0 || id > this.fileCount - 1) {
      throw new RangeError('ID is not in range, please check.')
    }

    const item = this.audioIDXItems[id]
    /** 声道数 */
    const audio_channels = item.flags & 1 ? 2 : 1
    /** 采样率 */
    const audio_sampleRate = item.sampleRate
    /** 位深度 */
    const audio_bitDepth = item.flags & 8 ? '4' : '16'
    /** 波形 */
    const audio_dataSamples = item.samples

    const wav = new WaveFile()
    if (audio_bitDepth == '16') {
      wav.fromScratch(
        audio_channels,
        audio_sampleRate,
        audio_bitDepth,
        new Int16Array(audio_dataSamples)
      )
    }
    if (audio_bitDepth == '4') {
      wav.fromScratch(
        audio_channels,
        audio_sampleRate,
        audio_bitDepth,
        new Uint8Array(audio_dataSamples)
      )
      wav.fmt.byteRate = (11100 * audio_channels * audio_sampleRate) / 22050
      wav.fmt.blockAlign = 512 * audio_channels
      wav.fmt.validBitsPerSample = 1017
    }
    return new AudioExactType(item.name, wav)
  }
  /**
   * 根据文件名，导出音频
   * @param {string} fileName 要查找的文件名，自动忽略扩展名
   */
  exactByName(fileName) {
    const ID = this._getIDByName(fileName)
    if (ID === -1) {
      throw new RangeError('FileName not find in bag file, please check.')
    }
    return this.exactByID(ID)
  }
  /**
   * 导出该 bag 文件内全部音频
   * @returns {AudioExactType[]}
   */
  exactAll() {
    const allFiles = []
    for (let index = 0; index < this.fileCount; index++) {
      const outputFile = this.exactByID(index)
      allFiles.push(outputFile)
    }
    return allFiles
  }
  /**
   * 根据索引 ID，移除单个音频
   * @param {number} id 索引ID
   * @returns {AudioIDXItem} 被移除的 AudioIDXItem
   */
  removeByID(id = -1) {
    if (id < 0 || id > this.fileCount - 1) {
      throw new RangeError('ID is not in range, please check.')
    }
    this._fileCount--
    return this._audioIDXItems.splice(id, 1)[0]
  }
  /**
   * 根据文件名，移除单个音频
   * @param {string} fileName 要查找的文件名，自动忽略扩展名
   * @returns {AudioIDXItem} 被移除的 AudioIDXItem
   */
  removeByName(fileName) {
    const ID = this._getIDByName(fileName)
    if (ID === -1) {
      throw new RangeError('FileName not find in bag file, please check.')
    }
    return this.removeByID(ID)
  }
  /**
   * 根据文件名，添加一个新音频
   * @param {string} fileName 文件名，自动忽略扩展名
   * @param {Buffer} wave 波形文件 Buffer 对象
   * @returns {AudioIDXItem} 新增的 AudioIDXItem
   */
  addItemFromWav(fileName, wave) {
    const nameStr = path
      .basename(fileName, path.extname(fileName))
      .substring(0, 15)
    const buff = Buffer.alloc(16)
    buff.write(nameStr)
    const name = buff.buffer
    const waveFile = new WaveFile(wave)

    const samples = waveFile.getSamples(false, Uint8Array)
    const size = Math.ceil(samples.length / 4) * 4
    const sampleRate = waveFile.fmt.sampleRate
    const format = waveFile.fmt.audioFormat // 0x0001 for 16bit PCM, 0x0011 for 4bit IMA ADPCM
    const channels = waveFile.fmt.numChannels
    let chunkSize = 0
    let flags = 4
    if (channels == 2) {
      flags |= 1
    }
    if (format == 0x01) {
      flags |= 2
      chunkSize = 0
    } else if (format == 0x11) {
      flags |= 8
      chunkSize = waveFile.fmt.blockAlign
    }
    const audioItem = new AudioIDXItem({
      name,
      size,
      sampleRate,
      flags,
      chunkSize,
      samples,
    })
    let id = this._getIDByName(nameStr)
    if (id === -1) {
      this._audioIDXItems.push(audioItem)
      this._fileCount++
      return audioItem
    } else {
      audioItem._name = Buffer.from(this._audioIDXItems[id].nameBuffer).buffer
      this._audioIDXItems[id] = audioItem
      return audioItem
    }
  }
  /**
   * 获取 Bag 文件
   * @returns {Buffer} Bag 格式文件 Buffer
   */
  getBagFile() {
    let fileSize = 0
    for (let index = 0; index < this.fileCount; index++) {
      fileSize += this.audioIDXItems[index].size
    }
    const buff = Buffer.alloc(fileSize)
    let offset = 0
    for (let index = 0; index < this.fileCount; index++) {
      const samples = Buffer.from(
        new Uint8Array(this.audioIDXItems[index].samples)
      )
      samples.copy(buff, offset, 0, samples.byteLength)
      offset += this.audioIDXItems[index].size
    }
    return buff
  }
  /**
   * 获取 Idx 文件
   * @returns {Buffer} Idx 格式文件 Buffer
   */
  getIdxFile() {
    const fileCount = this.fileCount
    const buff = new ArrayBuffer(0x0c + fileCount * 0x24) // 头文件使用 3 个 4byte，每条信息使用 16 byte + 5 * 4 byte
    const headerDataView = new DataView(buff, 0)

    headerDataView.setUint32(0x00, AudioPackage.MAGIC_NUMBER, false)
    headerDataView.setUint32(0x04, AudioPackage.MAGIC_NUMBER_2, true)
    headerDataView.setUint32(0x08, this.fileCount, true)

    let offset = 0
    for (let index = 0; index < this.fileCount; index++) {
      const itemDataView = new DataView(buff, 0x0c + index * 0x24)
      const item = this.audioIDXItems[index]
      const nameUint8Buff = new Uint8Array(item.nameBuffer)
      nameUint8Buff.forEach((val, idx) => {
        itemDataView.setUint8(idx, val)
      })
      itemDataView.setUint32(0x10, offset, true)
      itemDataView.setUint32(0x14, item.size, true)
      itemDataView.setUint32(0x18, item.sampleRate, true)
      itemDataView.setUint32(0x1c, item.flags, true)
      itemDataView.setUint32(0x20, item.chunkSize, true)
      offset += item.size
    }
    return Buffer.from(buff)
  }
}

module.exports = AudioPackage

// const bagFile = fs.readFileSync('./test/audio.bag')
// const idxFile = fs.readFileSync('./test/audio.idx')
// const audioReader = new AudioPackage(idxFile, bagFile)

// const input = fs.readFileSync('./test/src.wav')
// audioReader.addItemFromWav('src.wav', input)

// fs.writeFileSync(`./test/audioEdited.bag`, audioReader.getBagFile())
// fs.writeFileSync(`./test/audioEdited.idx`, audioReader.getIdxFile())

// const outputs = audioReader.exactAll()
// const output2 = audioReader.exactByName('agul02e.wav')

// outputs.forEach((output) => {
//   fs.writeFileSync(`./test/output/${output.name}.wav`, output.wav.toBuffer())
// })
// fs.writeFileSync(`./test/test2.wav`, output2.wav.toBuffer())
