/**
 * 간단한 작업 큐 시스템
 */
class Queue {
  constructor() {
    this.queue = [];
    this.processing = new Set();
    this.maxRetries = 3;
  }

  /**
   * 작업을 큐에 추가
   */
  enqueue(job) {
    this.queue.push({
      ...job,
      retries: 0,
      addedAt: Date.now()
    });
    console.log(`[Queue] Job enqueued: ${job.type} - ${job.pairAddress || job.id}`);
  }

  /**
   * 큐에서 작업 가져오기
   */
  dequeue() {
    if (this.queue.length === 0) {
      return null;
    }

    const job = this.queue.shift();
    this.processing.add(job.id || job.pairAddress);
    return job;
  }

  /**
   * 작업 완료 처리
   */
  complete(jobId) {
    this.processing.delete(jobId);
  }

  /**
   * 작업 실패 처리 (재시도)
   */
  fail(job) {
    this.processing.delete(job.id || job.pairAddress);
    
    if (job.retries < this.maxRetries) {
      job.retries++;
      this.queue.push(job);
      console.log(`[Queue] Job retry ${job.retries}/${this.maxRetries}: ${job.type} - ${job.pairAddress || job.id}`);
    } else {
      console.error(`[Queue] Job failed after ${this.maxRetries} retries: ${job.type} - ${job.pairAddress || job.id}`);
    }
  }

  /**
   * 큐 크기 반환
   */
  size() {
    return this.queue.length;
  }

  /**
   * 처리 중인 작업 수 반환
   */
  processingCount() {
    return this.processing.size;
  }

  /**
   * 큐 상태 반환
   */
  getStatus() {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      total: this.queue.length + this.processing.size
    };
  }
}

module.exports = { Queue };

