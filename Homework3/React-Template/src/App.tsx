

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import "./style.css";
import { hexbin } from "d3-hexbin";


/* =======================
   DATA TYPE (FIXED)
   ======================= */
type SpotifyRow = {
  track_popularity: number;
  track_duration_ms: number;
  artist_name: string;
  artist_popularity: number;
  artist_followers: number;
  artist_genres: string;
};

export default function App() {
  const [data, setData] = useState<SpotifyRow[]>([]);
const [selectedGenre, setSelectedGenre] = useState<string | null>(null);

  const view1Ref = useRef<SVGSVGElement | null>(null);
  const view2Ref = useRef<SVGSVGElement | null>(null);
  const view3Ref = useRef<SVGSVGElement | null>(null);

  /* =======================
     LOAD DATA
     ======================= */
  useEffect(() => {
    d3.csv("/data/spotify_data_clean.csv", d3.autoType).then(d => {
      setData(d as SpotifyRow[]);
    });
  }, []);



  /* =========================================================
     VIEW hexgram  — Popularity vs Track Duration
     ========================================================= */
  useEffect(() => {
    if (!data.length || !view1Ref.current) return;

    const getPrimaryGenre = (g: string) => {
      if (!g) return "other";
      return g.replace(/[\[\]']/g, "").split(",")[0]?.trim() || "other";
    };

    const filteredData = selectedGenre
      ? data.filter(d => getPrimaryGenre(d.artist_genres) === selectedGenre)
      : data;


    const svg = d3.select(view1Ref.current);
    svg.selectAll("*").remove();

    const width = 900;
    const height = 260;
    const margin = { top: 40, right: 30, bottom: 50, left: 60 };

 const tooltip = d3.select("body")
  .append("div")
  .style("position", "absolute")
  .style("background", "white")
  .style("padding", "6px")
  .style("border", "1px solid gray")
  .style("border-radius", "4px")
  .style("font-size", "12px")
  .style("opacity", 0);


    const x = d3.scaleLinear()
  .domain([0, 7])              
  .range([margin.left, width - margin.right])
  .clamp(true);


    const y = d3.scaleLinear()
      .domain([0, 100])
      .range([height - margin.bottom, margin.top]);

    svg.attr("viewBox", `0 0 ${width} ${height}`);
    const points = filteredData.map(d => [

      x(d.track_duration_ms / 60000),
      y(d.track_popularity)
    ]);

    const hex = hexbin()
      .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]])
      .radius(8);

    const bins = hex(points);

    const color = d3.scaleSequential(d3.interpolateBlues)
      .domain([0, d3.max(bins, d => d.length)!]);

      
    svg.append("g")
      .selectAll("path")
      .data(bins)
      .enter()
      .append("path")
.on("mouseover", function(event, d) {
  tooltip
    .style("opacity", 1)
    .html(`Tracks in bin: ${d.length}`)
    .style("left", event.pageX + 10 + "px")
    .style("top", event.pageY - 20 + "px");
})
.on("mouseout", () => tooltip.style("opacity", 0))
.attr("d", hex.hexagon())
.attr("opacity", 0)
.transition()
.duration(800)
.attr("opacity", 1)

      .attr("transform", d => `translate(${d.x},${d.y})`)
      .attr("fill", d => color(d.length))
      .attr("stroke", "white")
      .attr("stroke-width", 0.3);


    svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(6));

    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y));

    svg.append("text")
      .attr("x", width / 2)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("class", "title")
      .text("Track Duration vs Popularity");

    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height - 10)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .text("Track Duration (minutes)");

    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .text("Track Popularity");
}, [data, selectedGenre]);


  /* =========================================================
     VIEW 2 — FOCUS: Artist Attention
     ========================================================= */
  useEffect(() => {
    if (!data.length || !view2Ref.current) return;

const getPrimaryGenre = (g: string) => {
  if (!g) return "other";
  return g.replace(/[\[\]']/g, "").split(",")[0]?.trim() || "other";
};

const filteredData = selectedGenre
  ? data.filter(d => getPrimaryGenre(d.artist_genres) === selectedGenre)
  : data;


    const svg = d3.select(view2Ref.current);
    svg.selectAll("*").remove();

    const width = 400;
    const height = 320;
    const margin = { top: 40, right: 40, bottom: 40, left: 150 };

    const topArtists = d3.rollups(
      filteredData,
      v => d3.mean(v, d => d.artist_followers)!,
      d => d.artist_name
    )
      .sort((a, b) => d3.descending(a[1], b[1]))
      .slice(0, 10);

    const x = d3.scaleLinear()
      .domain([0, d3.max(topArtists, d => d[1])!])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleBand()
      .domain(topArtists.map(d => d[0]))
      .range([margin.top, height - margin.bottom])
      .padding(0.25);

    const colorScale = d3.scaleThreshold<number, string>()
      .domain([100_000_000, 110_000_000, 120_000_000, 130_000_000])
      .range([
        "#deebf7", // < 100M 
        "#9eb8d1", // 100–110M
        "#6d9eba", // 110–120M
        "#3f7dba", // 120–130M
        "#12538c"  // 130M+ 
      ]);


    


    svg.attr("viewBox", `0 0 ${width} ${height}`);

    svg.append("g")
      .selectAll("rect")
      .data(topArtists)
      .enter()
      .append("rect")
      .attr("x", margin.left)
      .attr("y", d => y(d[0])!)
      .attr("width", d => x(d[1]) - margin.left)
      .attr("height", y.bandwidth())
      .attr("fill", d => colorScale(d[1]))


    svg.append("g")
      .selectAll("text")
      .data(topArtists)
      .enter()
      .append("text")
      .attr("x", d => x(d[1]) + 5)
      .attr("y", d => y(d[0])! + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .attr("font-size", 11)
      .text(d => `${(d[1] / 1_000_000).toFixed(1)}M`);

    svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(
        d3.axisBottom(x)
          .ticks(4)
          .tickFormat(d => `${Number(d) / 1_000_000}M`)
      );

    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y));

    svg.append("text")
      .attr("x", width / 2)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("class", "title")
      .text("Top 10 Artists with the Highest Follower counts");

    svg.append("text")
  .attr("x", (margin.left + width - margin.right) / 2)
  .attr("y", height - 5)
  .attr("text-anchor", "middle")
  .attr("font-size", 11)
  .text("Artist Followers Counts");
svg.append("text")
  .attr("transform", "rotate(-90)")
  .attr("x", -(margin.top + height - margin.bottom) / 2)
  .attr("y", 20)
  .attr("text-anchor", "middle")
  .attr("font-size", 11)
  .text("Artist");
}, [data, selectedGenre]);

/* =========================================================
   VIEW 3 — Arc Diagram (Artist → Multiple Genres)
   ========================================================= */

useEffect(() => {
  if (!data.length || !view3Ref.current) return;

  const svg = d3.select(view3Ref.current);
  svg.selectAll("*").remove();

  const width = 750;
  const height = 380;
  const margin = { top: 50, right: 200, bottom: 40, left: 200 };

  svg.attr("viewBox", `0 0 ${width} ${height}`);

console.log(
  data
    .filter(d => d.artist_name === "Taylor Swift")
    .map(d => d.artist_genres)
);


  /* -------------------------
     1️⃣ Get Top 10 Artists
     ------------------------- */
  const topArtists = d3.rollups(
    data,
    v => d3.mean(v, d => d.artist_followers)!,
    d => d.artist_name
  )
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, 10)
    .map(d => d[0]);

  const filtered = data.filter(d =>
    topArtists.includes(d.artist_name)
  );

  /* -------------------------
     2️⃣ Build Artist → Genres Links
     ------------------------- */

/* -------------------------
   2️⃣ Build Artist → Genres Links (FIXED)
   ------------------------- */

const parseGenres = (g: string) => {
  if (!g) return [];
  return g
    .replace(/[\[\]']/g, "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
};

// Group by artist first
const artistGenreMap = new Map<string, Set<string>>();

filtered.forEach(d => {
  const genres = parseGenres(d.artist_genres);

  if (!artistGenreMap.has(d.artist_name)) {
    artistGenreMap.set(d.artist_name, new Set());
  }

  genres.forEach(g => {
    artistGenreMap.get(d.artist_name)!.add(g);
  });
});

// Now build links from aggregated map
const links: { artist: string; genre: string }[] = [];

artistGenreMap.forEach((genreSet, artist) => {
  genreSet.forEach(genre => {
    links.push({ artist, genre });
  });
});

const genres = Array.from(
  new Set(links.map(d => d.genre))
).sort();


  /* -------------------------
     3️⃣ Position Scales
     ------------------------- */

  const yArtist = d3.scalePoint()
    .domain(topArtists)
    .range([margin.top, height - margin.bottom]);

  const yGenre = d3.scalePoint()
    .domain(genres)
    .range([margin.top, height - margin.bottom]);

  const leftX = margin.left;
  const rightX = width - margin.right;

  /* -------------------------
     4️⃣ Draw Curved Links
     ------------------------- */

  const linkGroup = svg.append("g");

  linkGroup.selectAll("path")
    .data(links)
    .enter()
    .append("path")
    .attr("d", d => {
      const y1 = yArtist(d.artist)!;
      const y2 = yGenre(d.genre)!;
      const midX = (leftX + rightX) / 2;

      return `
        M ${leftX} ${y1}
        Q ${midX} ${(y1 + y2) / 2 - 50}
        ${rightX} ${y2}
      `;
    })
    .attr("fill", "none")
    .attr("stroke", "#9ecae1")
    .attr("stroke-width", 1.2)
    .attr("stroke-opacity", 0.5)
    .attr("class", "arc-link");

  /* -------------------------
     5️⃣ Interaction
     ------------------------- */

  const highlight = (name: string) => {
    svg.selectAll<SVGPathElement, any>(".arc-link")
      .attr("stroke", d =>
        d.artist === name || d.genre === name
          ? "#2171b5"
          : "#ddd"
      )
      .attr("stroke-width", d =>
        d.artist === name || d.genre === name
          ? 3
          : 1
      )
      .attr("stroke-opacity", d =>
        d.artist === name || d.genre === name
          ? 1
          : 0.1
      );
  };

  const reset = () => {
    svg.selectAll(".arc-link")
      .attr("stroke", "#9ecae1")
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.5);
  };

  /* -------------------------
     6️⃣ Draw Artist Labels
     ------------------------- */

  svg.append("g")
    .selectAll("text")
    .data(topArtists)
    .enter()
    .append("text")
    .attr("x", leftX - 15)
    .attr("y", d => yArtist(d)!)
    .attr("text-anchor", "end")
    .attr("alignment-baseline", "middle")
    .style("cursor", "pointer")
    .text(d => d)
    .on("click", (_, d) => highlight(d));

  /* -------------------------
     7️⃣ Draw Genre Labels
     ------------------------- */

  svg.append("g")
    .selectAll("text")
    .data(genres)
    .enter()
    .append("text")
    .attr("x", rightX + 15)
    .attr("y", d => yGenre(d)!)
    .attr("alignment-baseline", "middle")
    .style("cursor", "pointer")
    .text(d => d)
    .on("click", (_, d) => highlight(d));

  /* -------------------------
     Title
     ------------------------- */

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 25)
    .attr("text-anchor", "middle")
    .attr("class", "title")
    .text("Top 10 Artists and All Their Genres");



}, [data]);



return (
  <div id="main-container">

    {/* TOP ROW: MULTIVARIATE + FOCUS */}
    <div id="top-row">
      <div className="chart-container">
        <svg ref={view3Ref} />
      </div>

      <div className="chart-container">
        <svg ref={view2Ref} />
      </div>
    </div>

   <div id="overview-row">
  <div className="chart-container overview-container">
    <svg ref={view1Ref} />

    <div className="legend legend-inside">
      <strong>Legend</strong><br />
      <span style={{ color: "#bdbdbd" }}>■</span> Lower popularity<br />
      <span style={{ color: "#9ecae1" }}>■</span> Higher popularity<br />
      <span style={{ color: "#2171b5" }}>■</span> Highest popularity<br />
    </div>
  </div>
</div>



  </div>
);
}
