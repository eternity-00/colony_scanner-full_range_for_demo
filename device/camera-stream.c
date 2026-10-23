#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <linux/videodev2.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/select.h>
#include <time.h>
#include <unistd.h>

/* Native kernel ABI from videodev2.h; no packed offsets or copied ioctl numbers. */
struct mapping { void *data; size_t length; };
static int control(int fd, unsigned long request, void *arg) {
    int ret; do { ret = ioctl(fd, request, arg); } while (ret < 0 && errno == EINTR);
    return ret;
}
static double monotonic(void) {
    struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}
struct frame { void *data; double timestamp; unsigned sequence, flags; bool valid; };
/*
 * Exposure window relative to the frame timestamp (SOE cameras, seconds), measured on the
 * jig: the sensor exposes about 0.5-0.6 s after the timestamp. A frame is usable when the
 * axis stopped before timestamp + exposure_start; the axis may move again after
 * timestamp + exposure_end, long before the frame has crossed USB (~1.1 s).
 * Both 0 (5-argument call): the timestamp is taken as the exposure start (legacy).
 */
static bool fresh(double timestamp, double ready, unsigned flags, double period, double settle,
                  double exposure_start) {
    double exposure_guard = (flags & V4L2_BUF_FLAG_TSTAMP_SRC_MASK) == V4L2_BUF_FLAG_TSTAMP_SRC_SOE ? -exposure_start : period;
    return (flags & V4L2_BUF_FLAG_TIMESTAMP_MASK) == V4L2_BUF_FLAG_TIMESTAMP_MONOTONIC
        && !(flags & V4L2_BUF_FLAG_ERROR) && timestamp >= ready + settle + exposure_guard;
}
static int choose_frame(struct frame *frames, unsigned count, double ready, double period,
                        double settle, double exposure_start, bool have_previous, unsigned previous) {
    int chosen = -1;
    for (unsigned i = 0; i < count; i++) {
        struct frame *f = &frames[i];
        if (!f->valid || (have_previous && f->sequence <= previous) ||
            !fresh(f->timestamp, ready, f->flags, period, settle, exposure_start)) continue;
        if (chosen < 0 || f->timestamp < frames[chosen].timestamp) chosen = (int)i;
    }
    return chosen;
}
/* timestamp of the first frame on the stream's cadence (last + k * period) that is fresh
 * for `ready` and is a later frame than `after` */
static double predict(double last, double period, double ready, double settle, double exposure_start,
                      double after) {
    double need = ready + settle - exposure_start, t = last;
    if (need < after + period / 2) need = after + period / 2;
    if (t < need) t += period * (double)(long)((need - t) / period);
    while (t < need - 1e-6) t += period;
    return t;
}
static bool near(double a, double b) { return a > b - 1e-9 && a < b + 1e-9; }
struct request { double ready, requested, predicted, release; bool buffered; char path[4096]; };
static int write_frame(const char *path, const void *data, size_t bytes) {
    int out = open(path, O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (out < 0) return -1;
    size_t done = 0;
    while (done < bytes) {
        ssize_t wrote = write(out, (const char *)data + done, bytes - done);
        if (wrote < 0 && errno == EINTR) continue;
        if (wrote <= 0) { close(out); return -1; }
        done += (size_t)wrote;
    }
    return close(out);
}
int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        unsigned eof = V4L2_BUF_FLAG_TIMESTAMP_MONOTONIC;
        unsigned soe = eof | V4L2_BUF_FLAG_TSTAMP_SRC_SOE;
        struct frame f[3] = {{.timestamp=9,.sequence=1,.flags=soe,.valid=true},
                            {.timestamp=10.2,.sequence=2,.flags=soe,.valid=true},
                            {.timestamp=11.5,.sequence=3,.flags=soe,.valid=true}};
        return !(fresh(10,10,soe,1,0,0) && !fresh(10,10,eof,1,0,0) && fresh(11,10,eof,1,0,0)
                 && !fresh(12,10,0,1,0,0) && !fresh(12,10,eof|V4L2_BUF_FLAG_ERROR,1,0,0)
                 && !fresh(10.1,10,soe,1,.2,0) && choose_frame(f,3,10,1,0,0,false,0)==1
                 && choose_frame(f,3,10,1,0,0,true,2)==2 && choose_frame(f,3,12,1,0,0,false,0)==-1
                 /* exposure 0.4 s after the timestamp: a frame stamped 0.3 s before ready is usable */
                 && fresh(9.7,10,soe,1,0,.4) && !fresh(9.5,10,soe,1,0,.4) && choose_frame(f,3,10.5,1,0,.4,false,0)==1
                 && near(predict(9,1.04,10.5,0,.4,0),9+2*1.04) && near(predict(9,1.04,10.5,0,.4,11.08),9+3*1.04)
                 && near(predict(20,1,10,0,0,0),20));
    }
    if (argc != 6 && argc != 8) {
        fprintf(stderr, "usage: camera-stream DEVICE WIDTH HEIGHT BUFFER_FRAMES SETTLE_MS [EXPOSURE_START_MS EXPOSURE_END_MS]\n");
        return 2;
    }
    unsigned width = (unsigned)strtoul(argv[2], NULL, 10), height = (unsigned)strtoul(argv[3], NULL, 10);
    unsigned capacity = (unsigned)strtoul(argv[4], NULL, 10);
    double settle = strtod(argv[5],NULL) / 1000;
    double exposure_start = argc == 8 ? strtod(argv[6], NULL) / 1000 : 0;
    double exposure_end = argc == 8 ? strtod(argv[7], NULL) / 1000 : 0;
    if (!width || !height || capacity < 1 || capacity > 8 || settle < 0 || settle > 10 ||
        exposure_start < 0 || exposure_end < exposure_start || exposure_end > 2) return 2;
    struct frame frames[8] = {{0}}; unsigned cursor = 0, previous = 0; bool have_previous = false;
    /* requests queue up: the next well may be asked for before the last frame has arrived */
    enum { QUEUE = 8 };
    static struct request queue[QUEUE]; unsigned head = 0, queued = 0;
    double previous_time = -1e9, last_time = 0; unsigned last_sequence = 0;
    bool have_last = false, input_closed = false, period_measured = false;
    size_t frame_bytes = (size_t)width * height * 2;
    int fd = -1, result = 1; bool streaming = false;
    struct mapping maps[4] = {{0}}; unsigned count = 0;
    enum v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    fd = open(argv[1], O_RDWR | O_NONBLOCK);
    if (fd < 0) goto fail;
    struct v4l2_format format = {.type = V4L2_BUF_TYPE_VIDEO_CAPTURE};
    if (control(fd, VIDIOC_G_FMT, &format) < 0) goto fail;
    if (format.fmt.pix.pixelformat != V4L2_PIX_FMT_YUYV || format.fmt.pix.width != width ||
        format.fmt.pix.height != height || format.fmt.pix.bytesperline != width * 2 ||
        format.fmt.pix.sizeimage != width * height * 2) { errno = EINVAL; goto fail; }
    struct v4l2_streamparm parm = {.type=V4L2_BUF_TYPE_VIDEO_CAPTURE};
    if (control(fd, VIDIOC_G_PARM, &parm) < 0) goto fail;
    if (!parm.parm.capture.timeperframe.denominator || !parm.parm.capture.timeperframe.numerator) { errno=EPROTO; goto fail; }
    double period = (double)parm.parm.capture.timeperframe.numerator / parm.parm.capture.timeperframe.denominator;
    for (unsigned i=0;i<capacity;i++) { frames[i].data=malloc(frame_bytes); if (!frames[i].data) goto fail; }
    struct v4l2_requestbuffers req = {.count = 4, .type = V4L2_BUF_TYPE_VIDEO_CAPTURE, .memory = V4L2_MEMORY_MMAP};
    if (control(fd, VIDIOC_REQBUFS, &req) < 0) goto fail;
    if (req.count < 2 || req.count > 4) { errno = ENOMEM; goto fail; }
    for (unsigned i = 0; i < req.count; i++) {
        struct v4l2_buffer b = {.type = V4L2_BUF_TYPE_VIDEO_CAPTURE, .memory = V4L2_MEMORY_MMAP, .index = i};
        if (control(fd, VIDIOC_QUERYBUF, &b) < 0) goto fail;
        maps[i].length = b.length;
        maps[i].data = mmap(NULL, b.length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, b.m.offset);
        if (maps[i].data == MAP_FAILED) { maps[i].data = NULL; goto fail; }
        count++;
        if (control(fd, VIDIOC_QBUF, &b) < 0) goto fail;
    }
    if (control(fd, VIDIOC_STREAMON, &type) < 0) goto fail;
    streaming = true;
    puts("{\"event\":\"ready\"}"); fflush(stdout);
    double last_frame = monotonic();
    for (;;) {
        /* serve queued requests, oldest first, from frames already in the buffer */
        while (queued) {
            struct request *r = &queue[head];
            int chosen = choose_frame(frames,capacity,r->ready,period,settle,exposure_start,have_previous,previous);
            if (chosen < 0) break;
            struct frame *f = &frames[chosen];
            if (write_frame(r->path, f->data, frame_bytes) < 0) goto fail;
            double guard=(f->flags & V4L2_BUF_FLAG_TSTAMP_SRC_MASK)==V4L2_BUF_FLAG_TSTAMP_SRC_SOE?-exposure_start:period;
            /* an earlier frame than predicted was exposed before the release: still safe;
             * a later one may have been exposed while the axis moved on */
            bool on_schedule = r->release <= 0 || f->timestamp < r->predicted + period / 4;
            printf("{\"event\":\"frame\",\"frameMonotonic\":%.6f,\"requestedMonotonic\":%.6f,\"readyMonotonic\":%.6f,\"eligibleMonotonic\":%.6f,\"predictedMonotonic\":%.6f,\"releaseMonotonic\":%.6f,\"onSchedule\":%s,\"sequence\":%u,\"flags\":%u,\"buffered\":%s,\"bufferCapacity\":%u,\"exposureGuardSeconds\":%.6f,\"settleSeconds\":%.6f,\"periodSeconds\":%.6f}\n",
                   f->timestamp,r->requested,r->ready,r->ready+guard+settle,r->predicted,r->release,on_schedule?"true":"false",
                   f->sequence,f->flags,r->buffered?"true":"false",capacity,guard,settle,period);
            fflush(stdout);
            previous=f->sequence;have_previous=true;previous_time=f->timestamp;
            head=(head+1)%QUEUE;queued--;
        }
        if (input_closed && !queued) { result = 0; break; }
        fd_set ready; FD_ZERO(&ready); FD_SET(fd, &ready);
        if (!input_closed && queued < QUEUE) FD_SET(STDIN_FILENO, &ready);
        struct timeval timeout = {.tv_sec = 1};
        int n = select(fd + 1, &ready, NULL, NULL, &timeout);
        if (n < 0) { if (errno == EINTR) continue; goto fail; }
        if (monotonic() - last_frame > 30 || (queued && monotonic() - queue[head].requested > 30)) { errno = ETIMEDOUT; goto fail; }
        if (FD_ISSET(STDIN_FILENO, &ready)) {
            char command[4200];
            if (!fgets(command, sizeof(command), stdin)) { input_closed = true; continue; }
            struct request *r = &queue[(head + queued) % QUEUE];
            if (sscanf(command, "%lf %4095[^\n]", &r->ready, r->path) != 2 ||
                r->ready > monotonic()+1 || r->ready < monotonic()-30) { errno=EINVAL; goto fail; }
            r->requested = monotonic();
            /* the frame this request will get: one already buffered, or the next on the cadence */
            int chosen = queued ? -1 : choose_frame(frames,capacity,r->ready,period,settle,exposure_start,have_previous,previous);
            double after = queued ? queue[(head + queued - 1) % QUEUE].predicted : previous_time;
            r->buffered = chosen >= 0;
            r->predicted = chosen >= 0 ? frames[chosen].timestamp
                         : have_last ? predict(last_time,period,r->ready,settle,exposure_start,after) : r->ready;
            /* release: when the axis may move again (0 = only after the frame itself) */
            r->release = exposure_end > 0 && have_last ? r->predicted + exposure_end : 0;
            queued++;
            printf("{\"event\":\"scheduled\",\"predictedMonotonic\":%.6f,\"releaseMonotonic\":%.6f,\"buffered\":%s}\n",
                   r->predicted,r->release,r->buffered?"true":"false");
            fflush(stdout);
            continue;
        }
        if (FD_ISSET(fd, &ready)) {
            struct v4l2_buffer b = {.type = V4L2_BUF_TYPE_VIDEO_CAPTURE, .memory = V4L2_MEMORY_MMAP};
            if (control(fd, VIDIOC_DQBUF, &b) < 0) { if (errno == EAGAIN) continue; goto fail; }
            if (b.index >= count || b.bytesused > maps[b.index].length) { errno = EIO; goto fail; }
            last_frame = monotonic();
            if ((b.flags & V4L2_BUF_FLAG_TIMESTAMP_MASK) != V4L2_BUF_FLAG_TIMESTAMP_MONOTONIC) { errno = EPROTO; goto fail; }
            if (!(b.flags & V4L2_BUF_FLAG_ERROR) && b.bytesused == frame_bytes) {
                struct frame *f = &frames[cursor];
                memcpy(f->data,maps[b.index].data,frame_bytes);
                f->timestamp=b.timestamp.tv_sec+b.timestamp.tv_usec/1e6;
                f->sequence=b.sequence;f->flags=b.flags;f->valid=true;
                cursor=(cursor+1)%capacity;
            }
            /* cadence from the timestamps of every frame, also dropped or failed ones */
            double t=b.timestamp.tv_sec+b.timestamp.tv_usec/1e6;
            if (have_last && b.sequence > last_sequence && b.sequence - last_sequence <= 4) {
                double p = (t - last_time) / (double)(b.sequence - last_sequence);
                if (p > period * 0.5 && p < period * 1.5) {	/* first measurement replaces the nominal value */
                    period = period_measured ? period * 0.8 + p * 0.2 : p;
                    period_measured = true;
                }
            }
            last_time=t;last_sequence=b.sequence;have_last=true;
            if (control(fd, VIDIOC_QBUF, &b) < 0) goto fail;
        }
    }
    goto cleanup;
fail:
    fprintf(stderr, "CAMERA_STREAM_FAILED: %s\n", strerror(errno));
cleanup:
    if (streaming) control(fd, VIDIOC_STREAMOFF, &type);
    for (unsigned i = 0; i < count; i++) munmap(maps[i].data, maps[i].length);
    for (unsigned i=0;i<capacity;i++) free(frames[i].data);
    if (fd >= 0) close(fd);
    return result;
}
