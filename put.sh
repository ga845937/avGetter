docker rm avGetter -f
docker rmi avgetter
docker build -t avgetter /projects/avGetter
docker run -v /192.168.10.90:/192.168.10.90 -d -p 3004:3000 -e TZ=Asia/Taipei --name avGetter --restart always avgetter
