#!/bin/bash
cd /tmp; ffmpeg -version | head -1; cat /etc/os-release | head -1; nice -n 10 true && echo nice ok; ls /usr/share/fonts/truetype/dejavu/ | head -3; free -m | head -2
SERIF=/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf
T() { echo "--- $1"; shift; "$@" 2>&1 | tail -6; echo "exit ${PIPESTATUS[0]}"; }
ffmpeg -v error -y -f lavfi -i "testsrc2=s=1600x1067:r=1:d=1" -frames:v 1 -q:v 3 -update 1 src.jpg; echo src $?
echo -n "João e Inês" > c.txt
T card ffmpeg -v error -y -f lavfi -i "color=c=0xFBF8F1:s=1920x1080" -vf "drawtext=fontfile=$SERIF:textfile=c.txt:expansion=none:fontsize=110:fontcolor=0x33373B:x=(w-text_w)/2:y=400,drawbox=x=890:y=600:w=140:h=3:color=0xA98A4B:t=fill" -frames:v 1 -q:v 2 -update 1 s0.jpg
F='[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=28:2,eq=brightness=-0.2[bg];[0:v]scale=1920:1080:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,'
T photo ffmpeg -v error -y -i src.jpg -filter_complex "${F}format=yuvj444p" -frames:v 1 -q:v 2 -update 1 s1.jpg
T tone ffmpeg -v error -y -i src.jpg -filter_complex "${F}hue=s=0,eq=contrast=1.08,format=yuvj444p" -frames:v 1 -q:v 2 -update 1 s2.jpg
MO="scale=3840:2160:flags=bicubic,zoompan=z='1+0.14*on/119':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=120:s=1920x1080:fps=25,scale=in_range=pc:out_range=tv,format=yuvj420p"
MO="scale=3840:2160:flags=bicubic,zoompan=z='1+0.14*on/119':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=120:s=1920x1080:fps=25,scale=in_range=pc:out_range=tv,format=yuv420p"
for i in 0 1; do T motion$i ffmpeg -v error -y -i s$i.jpg -vf "$MO" -frames:v 120 -c:v libx264 -preset ultrafast -crf 12 -g 1 -threads 2 m$i.mp4; done
X="-c:v libx264 -preset veryfast -crf 21 -bf 0 -pix_fmt yuv420p -threads 2"
T hold ffmpeg -v error -y -i m0.mp4 -vf "trim=start_frame=20:end_frame=100,setpts=PTS-STARTPTS" $X hold0.mp4
for t in fade dissolve fadeblack smoothleft smoothright slideup circleopen radial; do T xf-$t ffmpeg -v error -y -i m0.mp4 -i m1.mp4 -filter_complex "[0:v]trim=start_frame=100:end_frame=120,setpts=PTS-STARTPTS[a];[1:v]trim=end_frame=20,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=$t:duration=0.8:offset=0" -frames:v 20 $X fade0.mp4; done
ffmpeg -v error -y -f lavfi -i "sine=frequency=330:duration=5" a.mp3
printf 'file hold0.mp4\nfile fade0.mp4\nfile hold0.mp4\n' > l.txt
T final ffmpeg -v error -y -f concat -safe 0 -i l.txt -stream_loop -1 -i a.mp3 -af afade=t=out:st=4:d=3 -c:a aac -b:a 192k -t 7 -c:v copy -movflags +faststart final.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 final.mp4
