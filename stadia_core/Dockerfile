FROM eclipse-temurin:21-jre-jammy

RUN apt-get update && apt-get install -y --no-install-recommends curl python3 && \
    rm -rf /var/lib/apt/lists/*

# Fuseki 6.0.0 — keep only the server jar
RUN mkdir -p /fuseki && \
    curl -fL "https://archive.apache.org/dist/jena/binaries/apache-jena-fuseki-6.0.0.tar.gz" \
      -o /tmp/f.tar.gz && \
    tar -xzf /tmp/f.tar.gz -C /tmp apache-jena-fuseki-6.0.0/fuseki-server.jar && \
    mv /tmp/apache-jena-fuseki-6.0.0/fuseki-server.jar /fuseki/fuseki-server.jar && \
    rm -rf /tmp/f.tar.gz /tmp/apache-jena-fuseki-6.0.0

COPY fuseki/stadia.ttl /fuseki/config/stadia.ttl
COPY fuseki/shiro.ini  /fuseki/shiro.ini.template
COPY fuseki/start.sh   /start.sh

# Seed TBox + shapes (add your generated ABox .ttl here, or load it at runtime)
COPY ontology/stadia.ttl        /data/seed/stadia.ttl
COPY shapes/stadia_shapes.ttl   /data/seed/stadia_shapes.ttl

RUN chmod +x /start.sh
EXPOSE 3030
CMD ["/start.sh"]
