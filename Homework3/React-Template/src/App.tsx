

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import "./style.css";
import { hexbin } from "d3-hexbin";


/* =======================
   DATA TYPE (FIXED)
   ======================= */
type SpotifyRowArtist = {
  track_popularity: number;
  artist_name: string;
  artist_popularity: number;
  artist_followers: number;
  artist_genres: string;
};


type SpotifyRowTrack = {
  track_name: string;          // ✅ add this
  track_popularity: number;
  track_duration_ms: number;
  artist_name: string;
  artist_popularity: number;
  artist_followers: number;
  artist_genres: string;
};

export default function App() {
const [data, setData] = useState<SpotifyRowArtist[]>([]);
const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
const [artistData, setArtistData] = useState<SpotifyRowArtist[]>([]);
const [trackData, setTrackData] = useState<SpotifyRowTrack[]>([]);


const [selectedNode, setSelectedNode] = useState<string | null>(null); //for view 2 
const [selectedType, setSelectedType] = useState<"artist" | "genre" | null>(null);


  const view1Ref = useRef<SVGSVGElement | null>(null);
  const view2Ref = useRef<SVGSVGElement | null>(null);
  const view3Ref = useRef<SVGSVGElement | null>(null);

  /* =======================
     LOAD DATA
     ======================= */
useEffect(() => {
  d3.csv("/data/spotify_data_clean.csv", d3.autoType).then(d => { //ArtistData
    setArtistData(d as SpotifyRowArtist[]);
  });
}, []);

useEffect(() => {
  d3.csv("/data/spotify.csv", d3.autoType).then(d => { //TrackData
    setTrackData(d as SpotifyRowTrack[]);
  });
}, []);




  /* =========================================================
     VIEW hexgram  — Popularity vs Track Duration
     ========================================================= */
  useEffect(() => {
    if (!trackData.length || !view1Ref.current) return;

    const getPrimaryGenre = (g: string) => {
      if (!g) return "other";
      return g.replace(/[\[\]']/g, "").split(",")[0]?.trim() || "other";
    };

    const filteredData = selectedGenre
      ? trackData.filter(d => getPrimaryGenre(d.artist_genres) === selectedGenre)
      : trackData;


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
}, [trackData, selectedGenre]);

// ==========================
// VIEW 2
// ==========================
useEffect(() => {
  if (!artistData.length || !view2Ref.current) return;

  const svg = d3.select(view2Ref.current);
  svg.selectAll("*").remove();

  const width = 500;
  const height = 340;
  const margin = { top: 60, right: 40, bottom: 50, left: 220 };

  let displayData: [string, number][] = [];
  let title = "Top 10 Artists Overall";

  // ===============================
  // CASE 1: Artist selected → Top 10 Songs
  // ===============================
  if (selectedNode && selectedType === "artist") {
    const topTracks = artistData
      .filter(d => d.artist_name === selectedNode)
      // dedupe track names
      .filter((d, i, arr) =>
        arr.findIndex(x => x.track_name === d.track_name) === i
      )
      .sort((a, b) =>
        d3.descending(a.track_popularity, b.track_popularity)
      )
      .slice(0, 10);

    displayData = topTracks.map(d => [
      d.track_name,
      d.track_popularity
    ]);

    title = `Top 10 Songs – ${selectedNode}`;
  }

  // ===============================
  // CASE 2: Genre selected → Top 10 Artists
  // ===============================
  else if (selectedNode && selectedType === "genre") {
     const genreFiltered = artistData.filter(d => {
  if (!d.artist_genres) return false;

  const genres = String(d.artist_genres)
    .split(",")
    .map(g => g.trim().toLowerCase());

  return genres.includes(selectedNode!.toLowerCase());
});


    displayData = d3.rollups(
      genreFiltered,
      v => d3.mean(v, d => d.artist_followers)!,
      d => d.artist_name
    )
      .sort((a, b) => d3.descending(a[1], b[1]))
      .slice(0, 10);

    title = `Top 10 Artists – ${selectedNode}`;
  }

  // ===============================
  // DEFAULT VIEW
  // ===============================
  else {
    displayData = d3.rollups(
      artistData,
      v => d3.mean(v, d => d.artist_followers)!,
      d => d.artist_name
    )
      .sort((a, b) => d3.descending(a[1], b[1]))
      .slice(0, 10);

    title = "Top 10 Artists Overall";
  }

  // If nothing found
  if (!displayData.length) {
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .attr("font-size", 13)
      .text("No matching data.");
    return;
  }

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3.scaleLinear()
    .domain([0, d3.max(displayData, d => d[1])!])
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(displayData.map(d => d[0]))
    .range([margin.top, height - margin.bottom])
    .padding(0.25);

  // ===============================
  // BARS
  // ===============================
  svg.append("g")
    .selectAll("rect")
    .data(displayData)
    .enter()
    .append("rect")
    .attr("x", margin.left)
    .attr("y", d => y(d[0])!)
    .attr("width", 0)
    .attr("height", y.bandwidth())
    .attr("fill", "#6baed6")
    .transition()
    .duration(700)
    .attr("width", d => x(d[1]) - margin.left);

  // ===============================
  // VALUES
  // ===============================
  svg.append("g")
    .selectAll("text.value")
    .data(displayData)
    .enter()
    .append("text")
    .attr("class", "value")
    .attr("x", d => x(d[1]) + 6)
    .attr("y", d => y(d[0])! + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("font-size", 11)
    .text(d => d[1]);

  // ===============================
  // AXES
  // ===============================
  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(5));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  // ===============================
  // TITLE
  // ===============================
  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 30)
    .attr("text-anchor", "middle")
    .attr("class", "title")
    .text(title);

  // ===============================
  // AXIS LABELS
  // ===============================

  // X Label
  svg.append("text")
    .attr("x", (margin.left + width - margin.right) / 2)
    .attr("y", height - 5)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .text(
      selectedType === "artist"
        ? "Track Popularity"
        : "Artist Followers"
    );

  // Y Label
  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + height - margin.bottom) / 2)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .text(
      selectedType === "artist"
        ? "Track Name"
        : "Artist Name"
    );

}, [artistData, selectedNode, selectedType]);


//view3

useEffect(() => {
if (!artistData.length || !view3Ref.current) return;


  const svg = d3.select(view3Ref.current);
  svg.selectAll("*").remove();

  const width = 1000;
  const height = 400;
  const margin = { top: 80, right: 40, bottom: 60, left: 40 };

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const baselineY = height - 100;

  /* -------------------------
     1️⃣ Top 10 Artists
     ------------------------- */

  const topArtists = d3.rollups(
    artistData,
    v => d3.mean(v, d => d.artist_followers)!,
    d => d.artist_name
  )
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, 10)
    .map(d => d[0]);

  const parseGenres = (g: string) => {
    if (!g) return [];
    return g
      .replace(/[\[\]']/g, "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
  };

  // Build artist → genres
  const artistGenreMap = new Map<string, Set<string>>();

  topArtists.forEach(artist => {
    const rows = artistData.filter(d => d.artist_name === artist);
    const set = new Set<string>();

    rows.forEach(d => {
      parseGenres(d.artist_genres).forEach(g => set.add(g));
    });

    artistGenreMap.set(artist, set);
  });

  const links: { source: string; target: string }[] = [];

  artistGenreMap.forEach((genres, artist) => {
    genres.forEach(g => {
      links.push({ source: artist, target: g });
    });
  });

  const genres = Array.from(
    new Set(links.map(d => d.target))
  );

  /* -------------------------
     2️⃣ Combine nodes in ONE array
     ------------------------- */

  const nodes = [...topArtists, ...genres];

  const x = d3.scalePoint()
    .domain(nodes)
    .range([margin.left, width - margin.right]);

  /* -------------------------
   3️⃣ Draw arcs
------------------------- */

const linkSelection = svg.append("g")
  .selectAll("path")
  .data(links)
  .enter()
  .append("path")
  .attr("d", d => {
    const x1 = x(d.source)!;
    const x2 = x(d.target)!;
    const r = Math.abs(x2 - x1) / 2;

    return `
      M ${x1} ${baselineY}
      A ${r} ${r} 0 0 1 ${x2} ${baselineY}
    `;
  })
  .attr("fill", "none")
  .attr("stroke", "#999")
  .attr("stroke-opacity", 0.4)
  .attr("stroke-width", 1.5)
  .attr("class", "arc-link");


/* -------------------------
   4️⃣ Draw nodes
------------------------- */

const nodeSelection = svg.append("g")
  .selectAll("circle")
  .data(nodes)
  .enter()
  .append("circle")
  .attr("cx", d => x(d)!)
  .attr("cy", baselineY)
  .attr("r", d =>
    topArtists.includes(d) ? 12 : 6
  )
  .attr("fill", d =>
    topArtists.includes(d) ? "#6baed6" : "#bdbdbd"
  )
  .attr("class", "arc-node")
  .style("cursor", "pointer");


/* -------------------------
   5️⃣ Labels
------------------------- */

/* -------------------------
   5️⃣ Labels (ROTATED 90°)
------------------------- */

const labelSelection = svg.append("g")
  .selectAll("text")
  .data(nodes)
  .enter()
  .append("text")
  .attr("x", d => x(d)!)
  .attr("y", baselineY + 30)   // slight offset below node
  .attr("transform", d => 
    `rotate(-90, ${x(d)!}, ${baselineY + 30})`
  )
  .attr("text-anchor", "end")  // makes it cleaner when rotated
  .attr("font-size", 12)
  .attr("class", "arc-label")
  .style("cursor", "pointer")
  .text(d => d);

/* -------------------------
   6️⃣ Interaction Logic
------------------------- */

let activeNode: string | null = null;

const highlight = (name: string) => {
  activeNode = name;

  // Highlight arcs
  linkSelection
    .attr("stroke", d =>
      d.source === name || d.target === name
        ? "#2171b5"
        : "#ddd"
    )
    .attr("stroke-width", d =>
      d.source === name || d.target === name
        ? 3
        : 1
    )
    .attr("stroke-opacity", d =>
      d.source === name || d.target === name
        ? 1
        : 0.1
    );

  // Highlight nodes
  nodeSelection
    .attr("fill", d =>
      d === name ? "#2171b5" : "#ccc"
    )
    .attr("r", d =>
      d === name ? 16 : (topArtists.includes(d) ? 12 : 6)
    );

  // Bold label
  labelSelection
    .attr("font-weight", d =>
      d === name ? "bold" : "normal"
    );
};

const reset = () => {
  activeNode = null;

  linkSelection
    .attr("stroke", "#999")
    .attr("stroke-width", 1.5)
    .attr("stroke-opacity", 0.4);

  nodeSelection
    .attr("fill", d =>
      topArtists.includes(d) ? "#6baed6" : "#bdbdbd"
    )
    .attr("r", d =>
      topArtists.includes(d) ? 12 : 6
    );

  labelSelection
    .attr("font-weight", "normal");
};


/* Attach click to both nodes and labels */

nodeSelection.on("click", (_, d) => {
  if (activeNode === d) {
    reset();
    setSelectedNode(null);
    setSelectedType(null);
  } else {
    highlight(d);
    setSelectedNode(d);
    setSelectedType(
      topArtists.includes(d) ? "artist" : "genre"
    );
  }
});

labelSelection.on("click", (_, d) => {
  if (activeNode === d) {
    reset();
    setSelectedNode(null);
    setSelectedType(null);
  } else {
    highlight(d);
    setSelectedNode(d);
    setSelectedType(
      topArtists.includes(d) ? "artist" : "genre"
    );
  }
});



  /* -------------------------
     Title
     ------------------------- */

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", -30)
    .attr("text-anchor", "middle")
    .attr("class", "title")
    .text("Top 10 Artists and Their Genre Connections");

}, [artistData]);




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
